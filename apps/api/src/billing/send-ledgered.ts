interface LedgerSend {
  claim: () => Promise<boolean>;
  release: () => Promise<void>;
  send: () => Promise<boolean>;
}

export async function sendLedgered({ claim, release, send }: LedgerSend): Promise<boolean> {
  if (!(await claim())) return false;

  let sent: boolean;
  try {
    sent = await send();
  } catch (error) {
    try {
      await release();
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], "Notice failed and the ledger could not be released");
    }
    throw error;
  }
  if (!sent) await release();
  return sent;
}
