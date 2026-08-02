# Changelog

## [0.7.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.6.0...shared-v0.7.0) (2026-08-02)


### Features

* **android:** a dot shows when something new shipped ([a396984](https://github.com/BytechLabs/Texturion/commit/a3969849534595175ae3715db0f213a8744262c5))
* **api:** a Canadian workspace can be billed in Canadian dollars ([0ea4335](https://github.com/BytechLabs/Texturion/commit/0ea4335856bd3d1acba811da1a72579b11195911))
* **api:** say what a call was about instead of typing it out afterwards ([8d33b20](https://github.com/BytechLabs/Texturion/commit/8d33b20bcd77077d3ad71fd2b45a5af8f831d90f))
* **app:** the banner that says what broke can now tell us about it ([221f1b9](https://github.com/BytechLabs/Texturion/commit/221f1b909ae900aa6b1260d48c74f7f4353be304))
* **app:** we say we will write back when a fix ships, and now we do ([7917b38](https://github.com/BytechLabs/Texturion/commit/7917b3823131e1d33f6dcb5e43a42fc819bf68b4))
* **clients:** a repeat customer is visible without opening the contact panel ([c3def7f](https://github.com/BytechLabs/Texturion/commit/c3def7f69ea259380709c1c876a33a451a651601)), closes [#505](https://github.com/BytechLabs/Texturion/issues/505)
* **clients:** a tech can see a repeat customer without reading a list ([77f659d](https://github.com/BytechLabs/Texturion/commit/77f659d0411405d33b7e8397fc59cf7ea9e48202)), closes [#410](https://github.com/BytechLabs/Texturion/issues/410)
* **compose:** a template can say the address, the time and who is coming ([39488a9](https://github.com/BytechLabs/Texturion/commit/39488a9c7352ef789a1529fb5c9959c5f511de17))
* **compose:** the composer preview stops hiding what it cannot know ([f50e31b](https://github.com/BytechLabs/Texturion/commit/f50e31b1ca636648a14547e4ee9cae5a7153ed39))
* **inbox:** a filter can be saved under a name and kept ([d03bd00](https://github.com/BytechLabs/Texturion/commit/d03bd00e860df22f10f7ac65b57fb3f4eba27783))
* **inbox:** the Quote sent list is waiting for you on Monday ([961cec0](https://github.com/BytechLabs/Texturion/commit/961cec07cb3d577adf283b4ed7799dafa04e68e8))
* **inbox:** two tags that mean the same thing can be merged into one ([af059a0](https://github.com/BytechLabs/Texturion/commit/af059a094311dbd32d4e421a14d5205fb653f7c1))
* **marketing:** a page says what shipped, so improvement stops being invisible ([8ba5aae](https://github.com/BytechLabs/Texturion/commit/8ba5aae29f83cdbcf1ce6bf5ccece9f4237dfc4a))
* **marketing:** campaign parameters survive scrubbing, and nothing else does ([7227403](https://github.com/BytechLabs/Texturion/commit/7227403d0c32e93623da4f0ec86f7f76e1a6f393)), closes [#296](https://github.com/BytechLabs/Texturion/issues/296)
* **mobile:** first-run guidance reaches the phones, where the crew works ([53abc80](https://github.com/BytechLabs/Texturion/commit/53abc8031cae269435bb11a2d32b2e9068e830ca)), closes [#476](https://github.com/BytechLabs/Texturion/issues/476)
* **settings:** the template editor offers all seven variables, and shows them working ([a3b5f6f](https://github.com/BytechLabs/Texturion/commit/a3b5f6fcf1aa9d41101ad95dab6ec46cbacd9404))
* **shared:** the rules a referral has to pass before it pays anybody ([51d806a](https://github.com/BytechLabs/Texturion/commit/51d806ad76d6b0e539bf07092aabe7a0020fb686))
* **signup:** ask how big the crew is, because that is where our price wins ([9a40601](https://github.com/BytechLabs/Texturion/commit/9a406016ee2763934b004910aeb02783002699ed))
* **web:** a dot shows when something new shipped, and never interrupts ([03f1d04](https://github.com/BytechLabs/Texturion/commit/03f1d043cdfef756225ebcd7e1cc6706b8a73c0e))


### Bug Fixes

* **stores:** the contacts permission iOS ships is now the one we declare ([308d0cd](https://github.com/BytechLabs/Texturion/commit/308d0cd0ee610ea1df9376d2d16500480e27687f))

## [0.6.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.5.0...shared-v0.6.0) (2026-08-01)


### Features

* **api:** billing is gated on the axis it means, not a rung on a ladder ([91fb03f](https://github.com/BytechLabs/Texturion/commit/91fb03f2db7f7530554a6e6ce857154b75014235)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **clients:** add a view-only role for people who should see the work, not change it ([fc87232](https://github.com/BytechLabs/Texturion/commit/fc87232b2a780da17005b7139378ed5e7fec6bc7)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **clients:** only an owner or admin can change the crew's saved replies ([733b877](https://github.com/BytechLabs/Texturion/commit/733b87702ff1aa950f47190fce0646378ff306c3)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315) [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **clients:** settings lists what is yours, not what you cannot touch ([ccc91bb](https://github.com/BytechLabs/Texturion/commit/ccc91bb2ad71cd6de9f4f5004e47bcc7cc8db12a)), closes [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **contacts:** the phone's own address book shows up beside the crew's ([fbf00b3](https://github.com/BytechLabs/Texturion/commit/fbf00b384ff8b21ab66855eb63d9e14ad7fbe9c0))
* **dialer:** the keypad finds people by name, and can text them ([cdc149b](https://github.com/BytechLabs/Texturion/commit/cdc149b98f937682110075709b17355b3b9b31e1))
* **mobile:** the bookkeeper and view-only roles reach both phones ([87d563c](https://github.com/BytechLabs/Texturion/commit/87d563c0ab0c69322cce78d64b446fd2b283fac4))
* **web:** add a bookkeeper role that gets billing without the inbox ([27f133e](https://github.com/BytechLabs/Texturion/commit/27f133e1c6b67d7554426a895cfcadfc42b60eaa)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)


### Bug Fixes

* **auth:** a second factor you turned on is now actually required ([f0f4946](https://github.com/BytechLabs/Texturion/commit/f0f49469a6f220b1b50ede39cd330c2bd012d3e4))

## [0.5.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.4.0...shared-v0.5.0) (2026-07-31)


### Features

* a failed text says why in plain terms, not a carrier's error number ([5e59ec0](https://github.com/BytechLabs/Texturion/commit/5e59ec0501143794d6179002a96e6b1903c3bebd)), closes [#241](https://github.com/BytechLabs/Texturion/issues/241)
* a switch that does not need a deploy, and a runbook for 2am ([52bae11](https://github.com/BytechLabs/Texturion/commit/52bae1104560bbe857221c9646f69c5976517e31)), closes [#283](https://github.com/BytechLabs/Texturion/issues/283)
* **api:** a second factor, and the recovery that makes it safe to turn on ([8a6e47e](https://github.com/BytechLabs/Texturion/commit/8a6e47e2e76e86421ce40b95ba82bf0b0b53f5b8))
* **api:** let an owner sign first messages with the business name ([c9da4b5](https://github.com/BytechLabs/Texturion/commit/c9da4b5780492e4e921638b85f506fb26e34d421)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **calls:** the voicemail asks what the job is, and writes the answer down ([a6e3c26](https://github.com/BytechLabs/Texturion/commit/a6e3c26b0a4c8e1d53adbe36b5a73bf0f6e47961))
* **clients:** ask before sending on top of a colleague's answer ([eeb3a1c](https://github.com/BytechLabs/Texturion/commit/eeb3a1c983a49c34394b4564c4fa1d0e47306298))
* **clients:** choose the words your customers text in an emergency ([f9a9b69](https://github.com/BytechLabs/Texturion/commit/f9a9b696128ea5076a6da1535379061ea180583f)), closes [#460](https://github.com/BytechLabs/Texturion/issues/460)
* **clients:** let an owner sign first texts, and count the signature ([176da2f](https://github.com/BytechLabs/Texturion/commit/176da2f4b1e9e244733da6424efad210ab5b27f2)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **clients:** say why you deferred it, not just until when ([df2b159](https://github.com/BytechLabs/Texturion/commit/df2b159e782edbe4bcc134fcdf8c0cf30b24256a)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **clients:** see which numbers a teammate reaches, and why ([e646669](https://github.com/BytechLabs/Texturion/commit/e646669b06ecb2398d39e0d1831fb58720e5d436))
* **compliance:** tell customers about the carrier's own daily ceiling ([c30f36c](https://github.com/BytechLabs/Texturion/commit/c30f36c1e7648cf6004344b04432d4d1f894b735))
* **focus:** remind me to chase this, if they haven't replied ([fd7a14d](https://github.com/BytechLabs/Texturion/commit/fd7a14d5b3356d088c97c2ee4eef3ff8a6bec94d)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **hours:** let a shop say it is closed on Christmas ([4e296eb](https://github.com/BytechLabs/Texturion/commit/4e296ebb940ff9019a88313e907525c2d060ecef))
* **presence:** the rule and the door for knowing who else is on a thread ([6155893](https://github.com/BytechLabs/Texturion/commit/6155893d43ddaf6ca706a5242ee32d829f63ba6e)), closes [#302](https://github.com/BytechLabs/Texturion/issues/302)
* **registration:** say why the carrier said no, and which box to fix ([78c7756](https://github.com/BytechLabs/Texturion/commit/78c7756bc8b46c498e17487fdd3a16d0c7cb84ea)), closes [#352](https://github.com/BytechLabs/Texturion/issues/352)
* **reports:** measure the first response we sell, and show the arc ([e337a89](https://github.com/BytechLabs/Texturion/commit/e337a89a7571501e36221c176ace56824bc63631)), closes [#239](https://github.com/BytechLabs/Texturion/issues/239)
* the server learns what everyone is running, and can ask them to move ([c10bd41](https://github.com/BytechLabs/Texturion/commit/c10bd41e21063d21645ccee02332e1489f051059)), closes [#339](https://github.com/BytechLabs/Texturion/issues/339)
* the wait for texting approval shows progress and what to do meanwhile ([a927841](https://github.com/BytechLabs/Texturion/commit/a927841d510098a2d389cea607b13e76ca054db7)), closes [#310](https://github.com/BytechLabs/Texturion/issues/310)
* **web:** ask us to email you the comparison, and unsubscribe in one click ([d57f125](https://github.com/BytechLabs/Texturion/commit/d57f125a32069d462d40c7e81743be65b607197c)), closes [#312](https://github.com/BytechLabs/Texturion/issues/312)
* **web:** defer a thread, and a way back to everything you deferred ([590912e](https://github.com/BytechLabs/Texturion/commit/590912ea207c6b77b0b4dc9349f901ad78b89836)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **web:** publish what deletion reaches, and what it does not ([e4772d8](https://github.com/BytechLabs/Texturion/commit/e4772d8b3f1451e9caecfcf31f568fcb8b680a50))


### Bug Fixes

* **attachments:** the allow-list matches the bucket, and a failed upload cleans up ([477f2dc](https://github.com/BytechLabs/Texturion/commit/477f2dc9be318705fed4db16ff4f958cf4d19a07)), closes [#262](https://github.com/BytechLabs/Texturion/issues/262)
* **clients:** a Canadian workspace can buy an extra number ([1ca1fde](https://github.com/BytechLabs/Texturion/commit/1ca1fde9a3adf83bd6a5761d2ab5d726b1985a6c)), closes [#464](https://github.com/BytechLabs/Texturion/issues/464)
* **clients:** stop offering to undo a STOP the customer sent ([9da7807](https://github.com/BytechLabs/Texturion/commit/9da7807b7803fa82b5a606ed1bdc576aaa7e3a6e))
* **ios:** keep an attribute attached to what it modifies ([d8ae70e](https://github.com/BytechLabs/Texturion/commit/d8ae70e70f4f249ef3e89321aa42922cc4edeeea))
* **legal:** say where a customer's voicemail is actually read ([545fde3](https://github.com/BytechLabs/Texturion/commit/545fde39a749744f8d3445f5b5462d5bf3ab63e1))
* **messaging:** the emergency reply stops assuming you are a plumber ([a01919b](https://github.com/BytechLabs/Texturion/commit/a01919b9a206088452a3241899ebf8ea54ae194c)), closes [#460](https://github.com/BytechLabs/Texturion/issues/460)
* telling the crew no longer waits for a two-minute buzz first ([01209b5](https://github.com/BytechLabs/Texturion/commit/01209b58f61d4b91749e259af62ca337f6bfcfa8)), closes [#463](https://github.com/BytechLabs/Texturion/issues/463)
* **web:** the sub-processors page says what we actually send to AI ([218a254](https://github.com/BytechLabs/Texturion/commit/218a2541e23b6d670bb44a048fcddfb10c2f7c15))

## [0.4.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.3.0...shared-v0.4.0) (2026-07-28)


### Features

* **api:** a customer who replies URGENT now gets an honest answer back ([ebe0511](https://github.com/BytechLabs/Texturion/commit/ebe0511fd50f6ee29bcd793011662e97df23c0a8))
* **api:** chase a new lead that nobody has answered yet ([6ea56df](https://github.com/BytechLabs/Texturion/commit/6ea56df3b4f1ce646765ae5b378664ea832bd462))
* **api:** warn the crew when a customer has asked to be left alone ([80fa415](https://github.com/BytechLabs/Texturion/commit/80fa415cc9eea450ed8c3681249ffbf538650415))
* **web:** a customer signed in can finally reach a person ([b58108c](https://github.com/BytechLabs/Texturion/commit/b58108c7b578b3dc44608f472e275b7bafe84eab))


### Bug Fixes

* **api:** an away reply that is switched on always has something to say ([d9c734d](https://github.com/BytechLabs/Texturion/commit/d9c734dfe87644d4c64697fd05409e55191a4e98))

## [0.3.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.2.0...shared-v0.3.0) (2026-07-26)


### Features

* **web:** fix a customer's timezone when their area code has it wrong ([285932f](https://github.com/BytechLabs/Texturion/commit/285932f61a1b359444a9533db2be7415834b8a27)), closes [#292](https://github.com/BytechLabs/Texturion/issues/292)

## [0.2.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.1.0...shared-v0.2.0) (2026-07-26)


### Features

* a text that fails now says why ([3316f9d](https://github.com/BytechLabs/Texturion/commit/3316f9da9f68a688f970ecff861ddea5d7a79382))
* **web:** the composer can draft a reply you edit before sending ([3897ae6](https://github.com/BytechLabs/Texturion/commit/3897ae6435a9d322dbe4cdd1443c62ebc27360cd))


### Bug Fixes

* a contacts file from another tool imports from a phone too ([b74e149](https://github.com/BytechLabs/Texturion/commit/b74e1497ca834e545c7489ab41daec39e2472153))
