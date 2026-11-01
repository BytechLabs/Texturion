# Mutes, or reads the mute state of, the Windows audio sessions of given
# processes, through Core Audio (IAudioSessionManager2, ISimpleAudioVolume).
# It touches only the sessions of the pids it is given: no default device, no
# system volume, no setting. Called by hostd; no dependencies.
#
#   emulator-audio.ps1 -Action processes
#   emulator-audio.ps1 -Action status -Pids 123,456   (one comma-separated argument)
#   emulator-audio.ps1 -Action mute   -Pids 123,456
#   emulator-audio.ps1 -Action serve                  (commands on stdin, one per line)
#
# Prints one line of JSON. processes: [{pid, ppid, name}]. status and mute:
# {"sessions":[{pid, muted, state, device}]}, where muted is read back from
# the session after any SetMute. A failure prints {"error": "..."} and exits 1.
#
# serve stays running for hostd. A session appears only when the emulator
# first plays sound, so a one-shot mute would land a moment late, and that
# moment is the beep. In serve, `mute <key> <pids>` also registers for new
# sessions (IAudioSessionNotification) and mutes one of those pids as soon as
# it is created. Commands, each answered by one line of JSON:
#   processes | status <pids> | mute <key> <pids> | clear <key>
# A line starting with "event " is not an answer: a session was muted when it
# was created. serve exits when stdin closes.
param(
  [Parameter(Mandatory = $true)][ValidateSet('processes', 'status', 'mute', 'serve')][string]$Action,
  [string]$Pids = ''
)

$ErrorActionPreference = 'Stop'

function Write-Line([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}

function Get-ProcessRows {
  $rows = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object {
      [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name }
    })
  ConvertTo-Json -InputObject $rows -Compress
}

function Read-Pids([string]$text) {
  $set = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($id in ($text -split ',' | Where-Object { $_.Trim() -ne '' })) { [void]$set.Add([int]$id) }
  , $set
}

function Get-Sessions($wanted, [bool]$mute) {
  $stateNames = @('inactive', 'active', 'expired')
  $found = @([RigAudioSessions]::Sessions($wanted, $mute) | ForEach-Object {
      [pscustomobject]@{ pid = $_.Pid; muted = $_.Muted; state = $stateNames[$_.State]; device = $_.Device }
    })
  ConvertTo-Json -InputObject ([pscustomobject]@{ sessions = $found }) -Compress -Depth 4
}

function Fail([string]$message) {
  ConvertTo-Json -InputObject ([pscustomobject]@{ error = $message }) -Compress
}

try {
  if ($Action -eq 'processes') {
    Write-Line (Get-ProcessRows)
    exit 0
  }

  Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class RigAudioSessions
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorClass { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr groupingId, uint streamFlags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr groupingId, uint streamFlags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        [PreserveSig] int RegisterSessionNotification(IAudioSessionNotification notification);
        [PreserveSig] int UnregisterSessionNotification(IAudioSessionNotification notification);
    }

    [ComImport, Guid("641DD20B-4D41-49CC-ABA3-174B9477BB08"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionNotification
    {
        [PreserveSig] int OnSessionCreated([MarshalAs(UnmanagedType.IUnknown)] object newSession);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    private const int eRender = 0;
    private const int DEVICE_STATE_ACTIVE = 1;
    private const int CLSCTX_ALL = 23;
    private static Guid SessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    public sealed class Row
    {
        public int Pid;
        public bool Muted;
        public int State;
        public string Device;
    }

    private static void Check(int hr)
    {
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    }

    private static IEnumerable<KeyValuePair<string, IAudioSessionManager2>> Managers()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
        IMMDeviceCollection devices;
        Check(enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out devices));
        uint count;
        Check(devices.GetCount(out count));
        for (uint d = 0; d < count; d++)
        {
            IMMDevice device;
            Check(devices.Item(d, out device));
            string id;
            device.GetId(out id);
            object managerObject;
            Guid iid = SessionManager2;
            if (device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out managerObject) < 0) continue;
            yield return new KeyValuePair<string, IAudioSessionManager2>(id, (IAudioSessionManager2)managerObject);
        }
    }

    /// <summary>The sessions of the given pids on every active playback device; with mute, mutes them and reads the state back.</summary>
    public static List<Row> Sessions(HashSet<int> pids, bool mute)
    {
        var rows = new List<Row>();
        foreach (var entry in Managers())
        {
            IAudioSessionEnumerator sessions;
            if (entry.Value.GetSessionEnumerator(out sessions) < 0) continue;
            int count;
            Check(sessions.GetCount(out count));
            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 control;
                if (sessions.GetSession(i, out control) < 0) continue;
                uint pid;
                if (control.GetProcessId(out pid) < 0 || !pids.Contains((int)pid)) continue;
                var volume = control as ISimpleAudioVolume;
                if (volume == null) continue;
                var context = Guid.Empty;
                if (mute) Check(volume.SetMute(true, ref context));
                bool muted;
                Check(volume.GetMute(out muted));
                int state;
                control.GetState(out state);
                rows.Add(new Row { Pid = (int)pid, Muted = muted, State = state, Device = entry.Key });
            }
        }
        return rows;
    }

    // Standing orders from hostd, by owner: a session of any of these pids is muted when it is created.
    private static readonly object Gate = new object();
    private static readonly Dictionary<string, HashSet<int>> Owners = new Dictionary<string, HashSet<int>>();
    // A registration ends when its session manager is released, so the managers are kept with their sinks.
    private static readonly Dictionary<string, object[]> Registered = new Dictionary<string, object[]>();
    private static readonly BlockingCollection<object> Created = new BlockingCollection<object>();
    private static Thread worker;

    private static bool Wanted(int pid)
    {
        lock (Gate)
        {
            foreach (var set in Owners.Values) if (set.Contains(pid)) return true;
        }
        return false;
    }

    public static void Hold(string owner, HashSet<int> pids)
    {
        lock (Gate) { Owners[owner] = pids; }
    }

    public static void Release(string owner)
    {
        lock (Gate) { Owners.Remove(owner); }
    }

    private sealed class Sink : IAudioSessionNotification
    {
        // The audio engine calls this on its own thread: hand the session over and return.
        public int OnSessionCreated(object newSession)
        {
            Created.Add(newSession);
            return 0;
        }
    }

    /// <summary>Starts listening for new sessions on every active playback device not yet listened to.</summary>
    public static void Listen()
    {
        if (worker == null)
        {
            worker = new Thread(MuteCreated) { IsBackground = true };
            worker.Start();
        }
        foreach (var entry in Managers())
        {
            if (Registered.ContainsKey(entry.Key)) continue;
            var sink = new Sink();
            if (entry.Value.RegisterSessionNotification(sink) < 0) continue;
            // Notifications are only delivered once the manager has enumerated its sessions, and while it and the enumerator are held.
            IAudioSessionEnumerator held;
            entry.Value.GetSessionEnumerator(out held);
            Registered[entry.Key] = new object[] { entry.Value, sink, held };
        }
    }

    private static void MuteCreated()
    {
        foreach (var session in Created.GetConsumingEnumerable())
        {
            try
            {
                var control = session as IAudioSessionControl2;
                var volume = session as ISimpleAudioVolume;
                uint pid;
                if (control == null || volume == null || control.GetProcessId(out pid) < 0 || !Wanted((int)pid)) continue;
                var context = Guid.Empty;
                if (volume.SetMute(true, ref context) >= 0)
                {
                    Console.Out.WriteLine("event muted " + pid);
                    Console.Out.Flush();
                }
            }
            catch (Exception) { }
        }
    }
}
'@

  if ($Action -ne 'serve') {
    try {
      Write-Line (Get-Sessions (Read-Pids $Pids) ($Action -eq 'mute'))
    } catch {
      Write-Line (Fail $_.Exception.Message)
      exit 1
    }
    exit 0
  }

  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $parts = @($line.Trim() -split '\s+' | Where-Object { $_ -ne '' })
    if ($parts.Count -eq 0) { continue }
    try {
      switch ($parts[0]) {
        'processes' { Write-Line (Get-ProcessRows) }
        'status' { Write-Line (Get-Sessions (Read-Pids ([string]$parts[1])) $false) }
        'mute' {
          if ($parts.Count -lt 3 -or $parts[1] -notmatch '^[a-z0-9-]{1,32}$') { throw 'mute <key> <pids>' }
          $set = Read-Pids ([string]$parts[2])
          [RigAudioSessions]::Hold($parts[1], $set)
          [RigAudioSessions]::Listen()
          Write-Line (Get-Sessions $set $true)
        }
        'clear' {
          if ($parts.Count -lt 2) { throw 'clear <key>' }
          [RigAudioSessions]::Release($parts[1])
          Write-Line '{"cleared":true}'
        }
        default { throw "unknown command $($parts[0])" }
      }
    } catch {
      Write-Line (Fail $_.Exception.Message)
    }
  }
} catch {
  Write-Line (Fail $_.Exception.Message)
  exit 1
}
