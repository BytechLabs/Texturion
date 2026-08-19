# Changelog

## [0.13.2](https://github.com/BytechLabs/Texturion/compare/shared-v0.13.1...shared-v0.13.2) (2026-08-19)


### Bug Fixes

* **mobile:** the widget snippet carries the workspace's language ([957ff61](https://github.com/BytechLabs/Texturion/commit/957ff61025866457a7f468d2ab7a0436cf16ceb8))

## [0.13.1](https://github.com/BytechLabs/Texturion/compare/shared-v0.13.0...shared-v0.13.1) (2026-08-19)


### Bug Fixes

* **web:** name every do-not-text spelling the importer actually accepts ([58d154e](https://github.com/BytechLabs/Texturion/commit/58d154e88bdfabcc63032f9c6ed9883817fc7442))

## [0.13.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.12.0...shared-v0.13.0) (2026-08-17)


### Features

* **api:** a member can subscribe to their own schedule from any calendar ([eb3568f](https://github.com/BytechLabs/Texturion/commit/eb3568f0c1647ce67ca2d8ab6f1090167f6454ce))
* **api:** push notifications arrive in the reader's own language ([09b4f1d](https://github.com/BytechLabs/Texturion/commit/09b4f1dcdef9160e8e8ec299f8778df4115f896f))
* **clients:** a held message says why in the reader's language ([2d811ba](https://github.com/BytechLabs/Texturion/commit/2d811baca33fe7c8a5b566c285904543b6ed2c53))
* **clients:** universal links open the app, for the paths the app can render ([1450aa3](https://github.com/BytechLabs/Texturion/commit/1450aa3c033c40e79a313d3c4b57227cc9cc20f2))


### Bug Fixes

* **api:** an API key cannot subscribe to data it is not allowed to read ([d2d081b](https://github.com/BytechLabs/Texturion/commit/d2d081be2f6db35d51c6d146456c1796a7e54ab5))
* **api:** the two texts we send a customer about money speak their language ([7866bfe](https://github.com/BytechLabs/Texturion/commit/7866bfe36d638579b289841a4eae9cc8e31171ee))
* **quotes:** sending a quote now actually sends it ([966f8a2](https://github.com/BytechLabs/Texturion/commit/966f8a24be1e24511da550f2dc1830ebbdbee795))

## [0.12.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.11.3...shared-v0.12.0) (2026-08-17)


### Features

* **android:** two-factor, the captcha and Google sign-in speak French ([557b29d](https://github.com/BytechLabs/Texturion/commit/557b29dd1e3e24f92e670a700f7340d86451d23d))
* **api:** a connector can subscribe itself, and only unsubscribe its own ([bf77734](https://github.com/BytechLabs/Texturion/commit/bf77734a99bc906d47000297bc323780c25cb664))
* **api:** a key that can do less than the person who made it ([e083c2a](https://github.com/BytechLabs/Texturion/commit/e083c2a27ab75bed49d2f6d23929f2ca12adc865))
* **api:** a workspace can say where it wants to be told ([f550dde](https://github.com/BytechLabs/Texturion/commit/f550dde4ca6767434b0952ec614ade679be828de))
* **api:** manage where a workspace is told, and prove it works ([2e89b8c](https://github.com/BytechLabs/Texturion/commit/2e89b8cd0bb64110242ab75b86235311fc9001d0))
* **clients:** a passkey works as a second factor on Android ([c3cbe2e](https://github.com/BytechLabs/Texturion/commit/c3cbe2eff44473f1f710308f1a0d579d3c6443bf))
* **clients:** let whoever does the books pull a period's usage from a phone ([#605](https://github.com/BytechLabs/Texturion/issues/605)) ([0d72460](https://github.com/BytechLabs/Texturion/commit/0d7246063f10be604783d29bef4eda50453e4bd4)), closes [#595](https://github.com/BytechLabs/Texturion/issues/595)
* **clients:** the Android app reads from a catalogue, and web finishes its own ([60e4289](https://github.com/BytechLabs/Texturion/commit/60e4289712cc2f4bcf1883e20f0295e08bd58ab6))
* **i18n:** a carrier rejection explains itself in French on the web too ([4428eaa](https://github.com/BytechLabs/Texturion/commit/4428eaa291fcc30efe828600202a4377765f80ee))
* **i18n:** a failed text explains itself in French on the web too ([2d1f4a6](https://github.com/BytechLabs/Texturion/commit/2d1f4a64fd10300418636de7f17c7e8911e7b28f))
* **i18n:** the app's own words get a catalogue, and a ledger that only shrinks ([5cd6fe1](https://github.com/BytechLabs/Texturion/commit/5cd6fe123c72f731b71c09bcb8490a8cc337afaf))
* **i18n:** the cancel card argues in the reader's language on the web ([170451b](https://github.com/BytechLabs/Texturion/commit/170451b39b906bcc8551c87af3823aad6c5d7263))
* **i18n:** the changelog reads in French on the web ([418a4a3](https://github.com/BytechLabs/Texturion/commit/418a4a343b4827c037985a3eb13dffe711adfc36))
* **i18n:** the hand-over-phone dialog reads in French ([a9d194d](https://github.com/BytechLabs/Texturion/commit/a9d194d18ed01637c402f0fc14f14f57f7c81675))
* **i18n:** the handover challenge reads in French ([a96ee66](https://github.com/BytechLabs/Texturion/commit/a96ee664a5a206b05a3448b15aba15cf926b85e4))
* **i18n:** the help screen and every support email read in French on the web ([e00410b](https://github.com/BytechLabs/Texturion/commit/e00410bd6f73f71a5eda55209e43ab797cd518f0))
* **i18n:** the list of what Stripe still wants reads in French on the web ([5818664](https://github.com/BytechLabs/Texturion/commit/5818664b76b8bbcf50cc8c164bc9dc07ff32ca58))
* **i18n:** the merge-field hints read in French on the web ([047da64](https://github.com/BytechLabs/Texturion/commit/047da64eee88a0d1f2e279f6a4f53bb6692d043c))
* **i18n:** the notification-delivery settings read in French on the web ([c2f9209](https://github.com/BytechLabs/Texturion/commit/c2f9209bd1df3e9b342369477f0518f0d9f8ffd8))
* **i18n:** the number-access rules explain themselves in French on the web ([d06a203](https://github.com/BytechLabs/Texturion/commit/d06a2038b638a9267c974bf8314eaa9709baf661))
* **i18n:** the on-call card and alert banner read in French ([1e9c5fd](https://github.com/BytechLabs/Texturion/commit/1e9c5fd88462eb2409262c836176e0649403a97f))
* **i18n:** the on-my-way text reaches a French customer in French (web) ([09ea509](https://github.com/BytechLabs/Texturion/commit/09ea509630f333aefa63037d4447ba2edcae788f))
* **i18n:** the pre-cutover checklist reads in French on the web ([8feeef6](https://github.com/BytechLabs/Texturion/commit/8feeef65db84034194c088f08947da31284ae3a3))
* **i18n:** the referral share sheet reads in French on the web ([f79e2dd](https://github.com/BytechLabs/Texturion/commit/f79e2ddb36fe7f602e6846651c557c61168da498))
* **i18n:** the registration progress card reads in French on the web ([10b3915](https://github.com/BytechLabs/Texturion/commit/10b3915f93fe72cf2ec7d8d0b6f2359c903c41b5))
* **i18n:** the send-later copy reads in French on the web ([503ddb3](https://github.com/BytechLabs/Texturion/commit/503ddb3ef6681327dd07fe3457dcdb67db931eb5))
* **i18n:** the Stripe account states say themselves in the reader's language ([fa25608](https://github.com/BytechLabs/Texturion/commit/fa256085cba99684beda61f15e5bf0a5bcbd503c))
* **i18n:** the web app reads from a catalogue, in two languages ([e214f6b](https://github.com/BytechLabs/Texturion/commit/e214f6beca4f8151cc7aff09ea540381403a0a56))
* **ios:** read every settings screen from the catalogue ([#609](https://github.com/BytechLabs/Texturion/issues/609)) ([163f210](https://github.com/BytechLabs/Texturion/commit/163f21078ee809f30da8a074e956d8f5eea52db3))
* **ios:** the app speaks French ([fd5f096](https://github.com/BytechLabs/Texturion/commit/fd5f09607f7c0fc899fbeaa2df259925f9e24c3a))
* **payments:** let a business collect from its customer over the thread ([b0df3aa](https://github.com/BytechLabs/Texturion/commit/b0df3aaf4c63504633485b1204190a3a5885df0e))
* **shared:** what a quote's status means, decided once for three clients ([960d16d](https://github.com/BytechLabs/Texturion/commit/960d16d7a5f6bc0c306017345f0b63f7ee5a1a56))
* **web:** connect the workspace to its other apps ([71fb50a](https://github.com/BytechLabs/Texturion/commit/71fb50aa8bf00d4931de9d2115da4caf8768677e))
* **web:** create and switch off API keys ([9fce70d](https://github.com/BytechLabs/Texturion/commit/9fce70d6e7a1093316d29aa25a30f1081dbb38a0))


### Bug Fixes

* **api:** a prepaid year that ends early now pays the rest back ([cf221a0](https://github.com/BytechLabs/Texturion/commit/cf221a0d4355a654ac677eee1e8701824cb10aeb))
* **clients:** the quotes panel stops printing a rate it just called uncallable ([f9fd2e5](https://github.com/BytechLabs/Texturion/commit/f9fd2e54484f7a3b02e9f41e26c898b5ae65a8c7))
* **i18n:** a French reader ends a prepaid year in French ([db8e41a](https://github.com/BytechLabs/Texturion/commit/db8e41ab61e3d04dd91cc09727ce7b2240299166))
* **i18n:** point the cross-client guards at the catalogue for iOS too ([15cb584](https://github.com/BytechLabs/Texturion/commit/15cb5848a7246b842485ab685c76d1826f0f9a59))
* **i18n:** the emergency-word screen warns in French, and now hears French ([f410dc4](https://github.com/BytechLabs/Texturion/commit/f410dc4cc79a22d1f985c08729f5a2b8a36f185a))
* **legal:** say that a workspace can send its own data somewhere ([a69f514](https://github.com/BytechLabs/Texturion/commit/a69f514a243ba17ddc21fc2893386c22a28ca7f1))
* **scripts:** a statement is not a sentence, so the ledger stops counting keywords ([fae1084](https://github.com/BytechLabs/Texturion/commit/fae1084ab0ce57876c69ecaccc8d58735c8e5ee7))
* **scripts:** the iOS ledger stops counting the Console as copy ([9f8657c](https://github.com/BytechLabs/Texturion/commit/9f8657c179108003f79dc7b4e294bdcbed4b9b77))
* **scripts:** the ledger stops counting finished translations as pending ([42b3c17](https://github.com/BytechLabs/Texturion/commit/42b3c1721d687e409749a16db43af5ea9811bbfd))
* **scripts:** the ledger stops reading TypeScript generics as JSX text ([51b7bbd](https://github.com/BytechLabs/Texturion/commit/51b7bbd61d511a7e7f2ecd74befa5852161e529b))
* **scripts:** the string ledger can finally see the copy all three apps share ([b54ed3b](https://github.com/BytechLabs/Texturion/commit/b54ed3b8be80d7e033a9c4a5fcf9c956393ff5b9))
* **scripts:** the string ledger reads sentences on the phones, not just inside Text() ([fe589ae](https://github.com/BytechLabs/Texturion/commit/fe589ae0d6de5e53dfa78e4c5afa49cbe9894e6c))
* **scripts:** the string ledger stops counting animation labels and preview fixtures ([4152f25](https://github.com/BytechLabs/Texturion/commit/4152f25f45a3e162370f6f6499f21840d15570a0))
* **scripts:** the string ledger stops counting logcat as copy ([eefea49](https://github.com/BytechLabs/Texturion/commit/eefea496cf9d55f5625d898e3acbee34db992707))
* **shared:** a French owner's referral message ends in French ([fcf037c](https://github.com/BytechLabs/Texturion/commit/fcf037c5e0ce86436406329ba869a86a969f2877))
* **shared:** remove two orphan string expressions the AI conversion left behind ([19a8619](https://github.com/BytechLabs/Texturion/commit/19a8619f93d6f7c8a33deba982976433c4a5df45))
* **shared:** the quotes card reads its own sentence in French on the web ([980b336](https://github.com/BytechLabs/Texturion/commit/980b33691a02139f22096c2224b2fe20bec64d3b))
* **shared:** the string ledger can finally see a sentence in backticks ([205ecdb](https://github.com/BytechLabs/Texturion/commit/205ecdb13c521a915bfe99e59e0a3b0074bfa375))
* **shared:** the string ledger stops counting six finished translations ([f96556c](https://github.com/BytechLabs/Texturion/commit/f96556ce8fabbbb16091b1aa6e6711ac7ea5f09a))


### Reverts

* **ios:** take back the catalogue port until its section exists ([c1fa4ec](https://github.com/BytechLabs/Texturion/commit/c1fa4eced38b0c78287864e7983b7a8d419289f4))

## [0.11.3](https://github.com/BytechLabs/Texturion/compare/shared-v0.11.2...shared-v0.11.3) (2026-08-09)


### Bug Fixes

* **clients:** a contact shows the same initials everywhere in the product ([93df0c2](https://github.com/BytechLabs/Texturion/commit/93df0c2b4d436cd31f1e43426dcb5a95969b9d53))
* **clients:** confirming a handover asks for something, and takes the answer ([14978dd](https://github.com/BytechLabs/Texturion/commit/14978dd8d6ade91afff09ceba30dfe62253f5a78))

## [0.11.2](https://github.com/BytechLabs/Texturion/compare/shared-v0.11.1...shared-v0.11.2) (2026-08-09)


### Bug Fixes

* **clients:** the thread an urgent text opens now says it is urgent ([474aef6](https://github.com/BytechLabs/Texturion/commit/474aef6253820a1d06ea8da491efcf17b6b876a9)), closes [#565](https://github.com/BytechLabs/Texturion/issues/565)

## [0.11.1](https://github.com/BytechLabs/Texturion/compare/shared-v0.11.0...shared-v0.11.1) (2026-08-08)


### Bug Fixes

* **contacts:** show every contact on the phone, not the first fifty ([094ceef](https://github.com/BytechLabs/Texturion/commit/094ceefb2a4f050cd11c3bbc11a63468ed806d79)), closes [#547](https://github.com/BytechLabs/Texturion/issues/547)
* **inbox:** make Reset in the filter menu actually reset ([3bf6ba6](https://github.com/BytechLabs/Texturion/commit/3bf6ba673b0f17b4687a35a4c84ecfaf903ea99e)), closes [#548](https://github.com/BytechLabs/Texturion/issues/548)

## [0.11.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.10.0...shared-v0.11.0) (2026-08-08)


### Features

* **api:** a note can say whether it is the before or the after ([beaca3c](https://github.com/BytechLabs/Texturion/commit/beaca3c107665451565a965127a62712dfb20bcf)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* ask new signups how they heard about us ([5f3fe9e](https://github.com/BytechLabs/Texturion/commit/5f3fe9ed4ea92da42b9ffbd2a5033fe61f94a9b9)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* recommend Loonext to another crew in one tap, from your phone ([8d44883](https://github.com/BytechLabs/Texturion/commit/8d4488316e231fa619d65ba06265449424db8414)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* **web:** draw an arrow on a photo before you send it ([144a0c2](https://github.com/BytechLabs/Texturion/commit/144a0c25c0d4cf60c542faf5f7ddd31b65961068)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)

## [0.10.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.9.0...shared-v0.10.0) (2026-08-08)


### Features

* **api:** send the handover code, and require it from owners with no app ([68d74c3](https://github.com/BytechLabs/Texturion/commit/68d74c3b3a67b544d8bedd5014e0b7090ead72ad)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **clients:** hand the truck phone over in one tap ([614ec2c](https://github.com/BytechLabs/Texturion/commit/614ec2cef808fd7b7afe44432bca287d521303c5)), closes [#330](https://github.com/BytechLabs/Texturion/issues/330)
* **web:** enter the code that confirms a handover ([6fab110](https://github.com/BytechLabs/Texturion/commit/6fab11054777425e8de047455c5b61d75a204f0d)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **web:** warn before going quiet while you are on call ([fc5134c](https://github.com/BytechLabs/Texturion/commit/fc5134c424670ad15d002ae4d0a6eeed7722ae06)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)


### Bug Fixes

* **api:** make taking your own access away deliberate ([12c7b24](https://github.com/BytechLabs/Texturion/commit/12c7b24f1310b82a1939c20537880c76b29776bd)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)

## [0.9.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.8.1...shared-v0.9.0) (2026-08-08)


### Features

* **api:** decide in one place whether a call may be summarised, and say no ([134e2f9](https://github.com/BytechLabs/Texturion/commit/134e2f92e6175560e0d4072419fe23b3782a7880)), closes [#509](https://github.com/BytechLabs/Texturion/issues/509)
* **clients:** let a member take a measure off their own screen ([58af901](https://github.com/BytechLabs/Texturion/commit/58af90141641f0456949013089c872c3d51a65dc)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **clients:** say why the customer's clock is the one that counts ([28134b2](https://github.com/BytechLabs/Texturion/commit/28134b2a521d4a3fc7d856057094e2e3fa8a9a2a)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **shared:** decide when a time needs to name whose clock it is ([44547b1](https://github.com/BytechLabs/Texturion/commit/44547b14994b560dc7994b4549b4a27947a69d90)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **web:** choose which clock a scheduled time is in ([3562d68](https://github.com/BytechLabs/Texturion/commit/3562d68d6bd8b651c8d59f8a71ea8c1a2aafa3c9)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **web:** put the most urgent thing first on the landing screen ([9f4d909](https://github.com/BytechLabs/Texturion/commit/9f4d90963cb033ceb79168335c350858c0c4703a)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)


### Bug Fixes

* **clients:** name each switch after the card it turns off ([16d43d1](https://github.com/BytechLabs/Texturion/commit/16d43d111aeffa46a395258529c3155e1b07e83c)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **clients:** read the number from a phone export, not the label next to it ([af1c14f](https://github.com/BytechLabs/Texturion/commit/af1c14fa97d47bf5ddc2088b943f1276b7f4c6fb)), closes [#248](https://github.com/BytechLabs/Texturion/issues/248)
* **clients:** show transfer advice at the same point on every device ([ce00869](https://github.com/BytechLabs/Texturion/commit/ce00869f5b4489e106e81fef6599a57894866aa0))


### Reverts

* **api:** drop live call recording and summaries for good ([ef67c62](https://github.com/BytechLabs/Texturion/commit/ef67c629121e93cb02a98d06b13572ccb32c62d6)), closes [#509](https://github.com/BytechLabs/Texturion/issues/509)

## [0.8.1](https://github.com/BytechLabs/Texturion/compare/shared-v0.8.0...shared-v0.8.1) (2026-08-07)


### Bug Fixes

* **api:** explain why a name cannot be marked do-not-text ([22c3708](https://github.com/BytechLabs/Texturion/commit/22c3708f63df89e16aad135c93cf6a1774b69762)), closes [#528](https://github.com/BytechLabs/Texturion/issues/528)
* **api:** refuse a contact file whose structure cannot be read ([00b2130](https://github.com/BytechLabs/Texturion/commit/00b213090b4476927acda53bcb430a2f6739e033)), closes [#528](https://github.com/BytechLabs/Texturion/issues/528)
* **clients:** say how many values an import column did not show ([8a0f170](https://github.com/BytechLabs/Texturion/commit/8a0f1707c6070a58e187cb022f50d8f7f38f32de)), closes [#528](https://github.com/BytechLabs/Texturion/issues/528)

## [0.8.0](https://github.com/BytechLabs/Texturion/compare/shared-v0.7.0...shared-v0.8.0) (2026-08-07)


### Features

* a missed call on the sales line texts back in the sales line's words ([9766b5d](https://github.com/BytechLabs/Texturion/commit/9766b5ddd00448b8dd7cc1a942064310cbec2ace))
* **android:** a workspace defines its own contact fields, and the crew fills them in ([5aadc16](https://github.com/BytechLabs/Texturion/commit/5aadc16cc18d57e83ac56f8ee00527a555ff0cca))
* **api:** a call that arrives after hours stops ringing everyone ([84d1ec5](https://github.com/BytechLabs/Texturion/commit/84d1ec52388761bf1edc2cbf9073dc142a93322f))
* **api:** a customer who texts AIDE gets an answer, in French ([5e6f79c](https://github.com/BytechLabs/Texturion/commit/5e6f79ca88f8f6eda3395b2265cf617a51aec125))
* **api:** a member can find out what they cannot reach, and why ([7d449b9](https://github.com/BytechLabs/Texturion/commit/7d449b90d2bef59212193ea511e783dad01e14c4))
* **api:** a member can silence their own nights without missing their page ([521f3da](https://github.com/BytechLabs/Texturion/commit/521f3da6cffb3cef0087eab8d05088434afc8fd7))
* **api:** a morning summary counts who is waiting and what is due ([b1111a6](https://github.com/BytechLabs/Texturion/commit/b1111a62ab9e879d9b42ff4399d61be1db42c012))
* **api:** a paid pause, so a quiet season does not cost the number ([c844477](https://github.com/BytechLabs/Texturion/commit/c844477216c8da61a41cc6cd77edd5677aa05231))
* **api:** a reminder never goes out for a job that is no longer booked ([82d9d58](https://github.com/BytechLabs/Texturion/commit/82d9d5836d68e9a24385fa29c717500a9ab5256e))
* **api:** a signup in a prohibited category is noticed before provisioning ([ece4281](https://github.com/BytechLabs/Texturion/commit/ece4281e27fb76a8d341df37c245400f558c7107)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** a workspace defines the contact fields its trade needs ([b871874](https://github.com/BytechLabs/Texturion/commit/b8718745f67f1a8b414d6ddbd03c2438551bda14))
* **api:** automated texts go out in the language the customer reads ([9b8fe24](https://github.com/BytechLabs/Texturion/commit/9b8fe24cd091255a1a0ddd033a858e764146612f))
* **api:** choose which recording a line plays ([71c52f7](https://github.com/BytechLabs/Texturion/commit/71c52f76e02d5a10a38c3003ae0a2e89765da946))
* **api:** ring the phones in turn, for as long as the line says ([56490fd](https://github.com/BytechLabs/Texturion/commit/56490fd774710a503ff01ab9e3e20f1298b28ed4))
* **api:** scheduled texts fire on time, and say so when they cannot ([1ec9260](https://github.com/BytechLabs/Texturion/commit/1ec9260bd6a04330b6a939f7f9b851825a4a1cd3))
* **api:** the AUP ladder's middle steps exist in code, not only in prose ([ef39e21](https://github.com/BytechLabs/Texturion/commit/ef39e217cccb2f6222b9d2b72ca2c82734b2df99)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** the language layer for automated texts, with fr-CA copy ([2dc2e0e](https://github.com/BytechLabs/Texturion/commit/2dc2e0eea7cefdc9352101cfbb273371063c9700))
* **api:** the question goes out after a job, and a digit answers it ([056b62a](https://github.com/BytechLabs/Texturion/commit/056b62a4a5cc0b3eb6bcf3edfb95c2fc9ba461af))
* **api:** work out when a job's reminders should go, and what they say ([ac498c5](https://github.com/BytechLabs/Texturion/commit/ac498c550eea68e9756caafe604b4df61526e1ff))
* **clients:** a joining orientation, and a notification ask with a reason ([d87bf03](https://github.com/BytechLabs/Texturion/commit/d87bf03635b7119bf56cf65bbd6e2b988a9f4da9)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** a member is told a number is hidden, not left to guess ([11d9ad4](https://github.com/BytechLabs/Texturion/commit/11d9ad4e252ac8bb9168e29d4711c8cee1f45549)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** a new member can see who the crew is ([10ac78b](https://github.com/BytechLabs/Texturion/commit/10ac78bc31da49b9b5059e31b9e86bf6d1a59717))
* **clients:** answer the reason somebody gives for leaving ([0109464](https://github.com/BytechLabs/Texturion/commit/0109464f7e43d9bc333282bc9753ff932e90fdc1))
* **clients:** catch up on a thread without Lou inventing anything ([21e57c0](https://github.com/BytechLabs/Texturion/commit/21e57c0243bd5cc7945be62c3dd691ca1d162533))
* **clients:** full-size photos can wait for Wi-Fi, and the baseline is written down ([d60faf9](https://github.com/BytechLabs/Texturion/commit/d60faf9458983d88fb509329147ce4e459a981c5)), closes [#289](https://github.com/BytechLabs/Texturion/issues/289)
* **clients:** one tap says "I have this", and the other phones stop ([2ef5b88](https://github.com/BytechLabs/Texturion/commit/2ef5b88b984cf37b9779bd4677a7fa86ac44013c))
* **clients:** pause a plan for the winter without losing the number ([b1444d7](https://github.com/BytechLabs/Texturion/commit/b1444d75c3725f79baf591ab1fa3a9e8e3734688))
* **clients:** put one person on call, and the rest get a quiet night ([af34999](https://github.com/BytechLabs/Texturion/commit/af34999d30b24c2d06a119ea2cd89f3cf6caf08a))
* **clients:** satisfaction sits beside response time, and refuses to guess ([94ae5ca](https://github.com/BytechLabs/Texturion/commit/94ae5ca3d0167d146bf88e67e400db1f38d411ff))
* **clients:** send later on both phones, and one place to see everything queued ([8987f1c](https://github.com/BytechLabs/Texturion/commit/8987f1cd7fa88dbe9b8efa6cb90692d80e867246))
* **clients:** set quiet hours without losing the night you are on call ([43c7b71](https://github.com/BytechLabs/Texturion/commit/43c7b71368ed0155f10b62c5da16a8e5b6594504))
* **clients:** stop holding the radio awake in somebody's pocket ([c789074](https://github.com/BytechLabs/Texturion/commit/c78907403f93956485c1ab23fb1209d3b1669834)), closes [#289](https://github.com/BytechLabs/Texturion/issues/289)
* **clients:** the note an owner writes reaches the person it was about ([2fc5b16](https://github.com/BytechLabs/Texturion/commit/2fc5b16725a458afec7a1aafd8ddbc286d86fada))
* **clients:** the phones can open the leads nobody answered ([bace185](https://github.com/BytechLabs/Texturion/commit/bace185b3444960ac3bcf877e41bf56c9d631ec5)), closes [#508](https://github.com/BytechLabs/Texturion/issues/508)
* **clients:** the uploader makes the preview, on all three ([a243318](https://github.com/BytechLabs/Texturion/commit/a243318aa6926af2ce43c0f3754da5edb6e930a2)), closes [#240](https://github.com/BytechLabs/Texturion/issues/240)
* **db:** a number can have its own identity, inherited until it does ([ba6e5f5](https://github.com/BytechLabs/Texturion/commit/ba6e5f5d3b00f0a5f28ad70ff91bffac4f17d4ea)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **db:** notifications can be grouped instead of arriving one at a time ([3ace857](https://github.com/BytechLabs/Texturion/commit/3ace857b54322881f7797127a680d0b803568dbe))
* **shared:** the words and choices for an on-my-way text ([3bead32](https://github.com/BytechLabs/Texturion/commit/3bead324019af5a10077c0a2db75db124637fd19))
* **web:** send an on-my-way text with an ETA, one tap from the thread ([5d0ce47](https://github.com/BytechLabs/Texturion/commit/5d0ce472fcb57422c9e7df64232cd90fae119c23))


### Bug Fixes

* **api:** a customer who texts ARRET is opted out, not answered ([824fab2](https://github.com/BytechLabs/Texturion/commit/824fab23ba699fee69c2974b68be84ceca04c4d6))
* **clients:** a Canadian workspace can buy an extra number again ([9b058f5](https://github.com/BytechLabs/Texturion/commit/9b058f5f96db82bee4eef17b0cd8c2672f8c4b49)), closes [#522](https://github.com/BytechLabs/Texturion/issues/522)
* **clients:** a role only reaches the settings its capabilities allow ([23ee9d1](https://github.com/BytechLabs/Texturion/commit/23ee9d1c617eb77cc9dedc7ffd7aa043660ccc09)), closes [#515](https://github.com/BytechLabs/Texturion/issues/515)
* **clients:** quote the currency the customer is actually charged in ([575f868](https://github.com/BytechLabs/Texturion/commit/575f8682db04eb5b7eccf8612834193fb69e2dad))
* **clients:** register the onboarding surface and the new firsts field ([c0fd159](https://github.com/BytechLabs/Texturion/commit/c0fd159ff13d9bd013aa9ac2bb643b9a37ddcbd1))
* **clients:** the in-app account deletion route cannot silently disappear ([a624586](https://github.com/BytechLabs/Texturion/commit/a62458607187594b8e361b7f2d633685dff30a19))
* **clients:** three automated texts stop costing double to deliver ([953b02c](https://github.com/BytechLabs/Texturion/commit/953b02c5a190dd66b9080b8fe00b4d13a0f977a7))
* **shared:** the identity fixture the workspace typecheck compiles ([631c906](https://github.com/BytechLabs/Texturion/commit/631c906d2233b95a97be20c8b36811c991ed5d3b))
* **web:** the production build resolves the shared locale module ([bb7d67e](https://github.com/BytechLabs/Texturion/commit/bb7d67ef3a298114e082820ac73ae977407b9d82))

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
