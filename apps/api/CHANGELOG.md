# Changelog

## [0.14.1](https://github.com/BytechLabs/Texturion/compare/api-v0.14.0...api-v0.14.1) (2026-08-08)


### Bug Fixes

* **ratings:** tell the crew when a customer rates the job badly ([0a2d127](https://github.com/BytechLabs/Texturion/commit/0a2d127c81328c0f72ba21c0b4c3d830e5cee019)), closes [#554](https://github.com/BytechLabs/Texturion/issues/554)

## [0.14.0](https://github.com/BytechLabs/Texturion/compare/api-v0.13.0...api-v0.14.0) (2026-08-08)


### Features

* **api:** a note can say whether it is the before or the after ([beaca3c](https://github.com/BytechLabs/Texturion/commit/beaca3c107665451565a965127a62712dfb20bcf)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* ask new signups how they heard about us ([5f3fe9e](https://github.com/BytechLabs/Texturion/commit/5f3fe9ed4ea92da42b9ffbd2a5033fe61f94a9b9)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* recommend Loonext to another crew in one tap, from your phone ([8d44883](https://github.com/BytechLabs/Texturion/commit/8d4488316e231fa619d65ba06265449424db8414)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* send a customer the photos of their own job ([2d1907a](https://github.com/BytechLabs/Texturion/commit/2d1907afbc97787f7bf31f4ed4e3b6c69701207d)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* take the location out of photos before we store them ([d8c49c9](https://github.com/BytechLabs/Texturion/commit/d8c49c9e17a2d5592dd4ad2aa0a424047d8dd76b)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)


### Bug Fixes

* a referral is earned when the business it brought starts working ([7517419](https://github.com/BytechLabs/Texturion/commit/751741968dbc9cc4f3239697989bc674b545f379)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)

## [0.13.0](https://github.com/BytechLabs/Texturion/compare/api-v0.12.0...api-v0.13.0) (2026-08-08)


### Features

* **api:** ask for a code before the business changes hands ([7c24dd4](https://github.com/BytechLabs/Texturion/commit/7c24dd4366c71d065c1ddf0a5f468ebd7f6e8e19)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **api:** send the handover code, and require it from owners with no app ([68d74c3](https://github.com/BytechLabs/Texturion/commit/68d74c3b3a67b544d8bedd5014e0b7090ead72ad)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* ask who you are before the doors that don't reopen ([d3ac642](https://github.com/BytechLabs/Texturion/commit/d3ac642ee535ed6c2a575dffa3fd86d0c65d2539)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)


### Bug Fixes

* **api:** make taking your own access away deliberate ([12c7b24](https://github.com/BytechLabs/Texturion/commit/12c7b24f1310b82a1939c20537880c76b29776bd)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)
* **api:** register the confirmation table as tenant-scoped ([d5746f5](https://github.com/BytechLabs/Texturion/commit/d5746f5936bf94527835467188d576fadcffa15d)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **api:** type the refusal body the ownership test reads ([73867e9](https://github.com/BytechLabs/Texturion/commit/73867e9a37f28dcbe92610743d274087e1380979)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)

## [0.12.0](https://github.com/BytechLabs/Texturion/compare/api-v0.11.1...api-v0.12.0) (2026-08-08)


### Features

* **clients:** let a member take a measure off their own screen ([58af901](https://github.com/BytechLabs/Texturion/commit/58af90141641f0456949013089c872c3d51a65dc)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)

## [0.11.1](https://github.com/BytechLabs/Texturion/compare/api-v0.11.0...api-v0.11.1) (2026-08-07)


### Bug Fixes

* **api:** refuse a contact file whose structure cannot be read ([00b2130](https://github.com/BytechLabs/Texturion/commit/00b213090b4476927acda53bcb430a2f6739e033)), closes [#528](https://github.com/BytechLabs/Texturion/issues/528)

## [0.11.0](https://github.com/BytechLabs/Texturion/compare/api-v0.10.0...api-v0.11.0) (2026-08-07)


### Features

* a missed call on the sales line texts back in the sales line's words ([9766b5d](https://github.com/BytechLabs/Texturion/commit/9766b5ddd00448b8dd7cc1a942064310cbec2ace))
* **api,web:** choose what happens to a call after hours ([4a25b8e](https://github.com/BytechLabs/Texturion/commit/4a25b8ecda8d21dbb2fe03e97f892fc3591318c8))
* **api:** a bad answer wakes somebody today, not next month ([e8d70e6](https://github.com/BytechLabs/Texturion/commit/e8d70e6ccf5acc3a45ed895d3495beba8276c7a6))
* **api:** a bookkeeper can take a period's usage away as a file ([2e7713b](https://github.com/BytechLabs/Texturion/commit/2e7713baa396ff771bb6b8ea6db8bf6e516a7a85)), closes [#304](https://github.com/BytechLabs/Texturion/issues/304)
* **api:** a call that arrives after hours stops ringing everyone ([84d1ec5](https://github.com/BytechLabs/Texturion/commit/84d1ec52388761bf1edc2cbf9073dc142a93322f))
* **api:** a caller hears the line they rang, not the workspace ([df0b26d](https://github.com/BytechLabs/Texturion/commit/df0b26d140c075753bf038b0572b8996daada0b9)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **api:** a complaint RATE is caught, not only a complaint count ([0f13da8](https://github.com/BytechLabs/Texturion/commit/0f13da822aeb146d95e0bdc982b9768b88788276)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** a customer can be found by any number they answer ([d3f9610](https://github.com/BytechLabs/Texturion/commit/d3f96103e19b746411076fe41dfc5029e9f4cb36))
* **api:** a customer record holds more than one address ([c3564b7](https://github.com/BytechLabs/Texturion/commit/c3564b74258cf83de39e57666d3f04198a1b375b))
* **api:** a customer who texts AIDE gets an answer, in French ([5e6f79c](https://github.com/BytechLabs/Texturion/commit/5e6f79ca88f8f6eda3395b2265cf617a51aec125))
* **api:** a customer's addresses can be added and reordered one at a time ([dfd79c6](https://github.com/BytechLabs/Texturion/commit/dfd79c6f153c6978470edf0e44e69bda44e3dfab))
* **api:** a line can keep its own hours and its own timezone ([4356167](https://github.com/BytechLabs/Texturion/commit/43561679cd493c659a1187d390c9daaf0f3a8124))
* **api:** a member can find out what they cannot reach, and why ([7d449b9](https://github.com/BytechLabs/Texturion/commit/7d449b90d2bef59212193ea511e783dad01e14c4))
* **api:** a member can silence their own nights without missing their page ([521f3da](https://github.com/BytechLabs/Texturion/commit/521f3da6cffb3cef0087eab8d05088434afc8fd7))
* **api:** a morning summary counts who is waiting and what is due ([b1111a6](https://github.com/BytechLabs/Texturion/commit/b1111a62ab9e879d9b42ff4399d61be1db42c012))
* **api:** a paid pause, so a quiet season does not cost the number ([c844477](https://github.com/BytechLabs/Texturion/commit/c844477216c8da61a41cc6cd77edd5677aa05231))
* **api:** a reminder never goes out for a job that is no longer booked ([82d9d58](https://github.com/BytechLabs/Texturion/commit/82d9d5836d68e9a24385fa29c717500a9ab5256e))
* **api:** a reply to our email reaches a person, and losing a number warns twice ([077f065](https://github.com/BytechLabs/Texturion/commit/077f06586c63f6fd03303818ab55651e0729c0bd)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **api:** a signup in a prohibited category is noticed before provisioning ([ece4281](https://github.com/BytechLabs/Texturion/commit/ece4281e27fb76a8d341df37c245400f558c7107)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** a workspace can choose the language its texts go out in ([2079623](https://github.com/BytechLabs/Texturion/commit/20796232779491d0f15d020d7d474ba62669f324))
* **api:** a workspace defines the contact fields its trade needs ([b871874](https://github.com/BytechLabs/Texturion/commit/b8718745f67f1a8b414d6ddbd03c2438551bda14))
* **api:** an abuse report cannot be crowded out by ordinary traffic ([3112c3a](https://github.com/BytechLabs/Texturion/commit/3112c3abbdff1ba15f593739bb46a77e07eb2d55)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** an after-hours missed call wakes the person holding the phone ([c227c6d](https://github.com/BytechLabs/Texturion/commit/c227c6dc2832ca9c1e043ba166e9e5edeb434528))
* **api:** an owner can give a line its own name, greeting and away reply ([3344704](https://github.com/BytechLabs/Texturion/commit/3344704e7851cd5c855008f28b6f2c836f1d6cc8)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **api:** an owner can say why they are adding somebody ([e1e3204](https://github.com/BytechLabs/Texturion/commit/e1e320400d8df1c4d042a2a2042f3ea32afbab80))
* **api:** an unanswered page widens, and one tap stops the other phones ([8edac50](https://github.com/BytechLabs/Texturion/commit/8edac509ccebc34410d940ec1c17d76772ad1458))
* **api:** ask for one customer's history over a date range ([e95656b](https://github.com/BytechLabs/Texturion/commit/e95656beaee9000b2ed39c55059b7160ecebc882))
* **api:** ask the DNS whether our email still authenticates ([800b462](https://github.com/BytechLabs/Texturion/commit/800b462ee3218025577a4e0e5bbad7c83a2f93d3)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **api:** automated texts go out in the language the customer reads ([9b8fe24](https://github.com/BytechLabs/Texturion/commit/9b8fe24cd091255a1a0ddd033a858e764146612f))
* **api:** build one customer's history as a document, not a screenshot ([5609e7d](https://github.com/BytechLabs/Texturion/commit/5609e7dcefd83c27f84d7ee2e2bb189515a259d1))
* **api:** call records and their transcripts age out with everything else ([c8b12ac](https://github.com/BytechLabs/Texturion/commit/c8b12ac432aacd8ed0cb3c9fb3c77dd3b2127e16)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **api:** calls and voicemails join the history document ([3e725a4](https://github.com/BytechLabs/Texturion/commit/3e725a48ab78bb6989f1ea6d31dfa0bfbe3c0ffb))
* **api:** choose which recording a line plays ([71c52f7](https://github.com/BytechLabs/Texturion/commit/71c52f76e02d5a10a38c3003ae0a2e89765da946))
* **api:** conversations by source, and the part that is "we don't know" ([bbe61e0](https://github.com/BytechLabs/Texturion/commit/bbe61e0078ce2ce06f70574d67746a02e0adfa37))
* **api:** critical mail can leave by its own door ([5f25c1e](https://github.com/BytechLabs/Texturion/commit/5f25c1ee27c111052ce77589a254b380f083dbcd)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **api:** group a burst of new messages into one notification ([b9ee89e](https://github.com/BytechLabs/Texturion/commit/b9ee89e56a4dbe816de1a2e0319a7c1a27d6c2e7))
* **api:** narrow the contacts list to one answer in a custom field ([bdebbca](https://github.com/BytechLabs/Texturion/commit/bdebbca5c83cd98234687deef3fbf6fe2b09a4aa))
* **api:** notice a workspace sending like a spammer before a carrier does ([933a196](https://github.com/BytechLabs/Texturion/commit/933a19612618fde23284be9b7ed5d896e26d2a38)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** play the owner's own voice, and never leave a caller in silence ([9734597](https://github.com/BytechLabs/Texturion/commit/9734597d739c17a8e3113278361d087617bc8c64))
* **api:** record a customer's other numbers ([b2ee3b5](https://github.com/BytechLabs/Texturion/commit/b2ee3b51e17eb3d5c81ce180c0779e5939fcc4b2))
* **api:** record why a workspace says it is leaving ([0881efc](https://github.com/BytechLabs/Texturion/commit/0881efc800e884a2a4c2da5e85b9c4d068816a39))
* **api:** record, list and delete a greeting ([486bdce](https://github.com/BytechLabs/Texturion/commit/486bdce826d3675fb9c256c5c22ed74c09baff96))
* **api:** reminder rules, and a customer's "C" marks the job confirmed ([7b577ef](https://github.com/BytechLabs/Texturion/commit/7b577efa64b9fb974c5f176aeffebe368c54377b))
* **api:** retention is enforced, not just promised ([0f5697a](https://github.com/BytechLabs/Texturion/commit/0f5697a10fc8c97caece2d2ec44ec902a3be7090)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **api:** ring the owner so they can record the greeting by phone ([d0a8a6d](https://github.com/BytechLabs/Texturion/commit/d0a8a6db70cdab79aca8121516d698b48d5130c0))
* **api:** ring the phones in turn, for as long as the line says ([56490fd](https://github.com/BytechLabs/Texturion/commit/56490fd774710a503ff01ab9e3e20f1298b28ed4))
* **api:** scheduled texts fire on time, and say so when they cannot ([1ec9260](https://github.com/BytechLabs/Texturion/commit/1ec9260bd6a04330b6a939f7f9b851825a4a1cd3))
* **api:** serve a picture of the file, not the file ([0401b69](https://github.com/BytechLabs/Texturion/commit/0401b69f62f177cf4ed755dc11842409f2f64e82)), closes [#240](https://github.com/BytechLabs/Texturion/issues/240)
* **api:** the after-hours reply follows the line's clock, not the workspace's ([7688808](https://github.com/BytechLabs/Texturion/commit/7688808ca7950e0ea1f2d090ee6dc58c37c2614b))
* **api:** the AUP ladder's middle steps exist in code, not only in prose ([ef39e21](https://github.com/BytechLabs/Texturion/commit/ef39e217cccb2f6222b9d2b72ca2c82734b2df99)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** the away reply comes from the line that was texted ([0100eef](https://github.com/BytechLabs/Texturion/commit/0100eefdcb10067dcd413e7608153382886e41a5)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **api:** the contact detail carries a customer's other numbers ([3fdaa64](https://github.com/BytechLabs/Texturion/commit/3fdaa64f5ab95dc3798c94bbe894d9768b244cf6))
* **api:** the inbox can filter to threads nobody has answered yet ([869bf97](https://github.com/BytechLabs/Texturion/commit/869bf97dc6070740f06dd35537b3274cc30e76e1)), closes [#508](https://github.com/BytechLabs/Texturion/issues/508)
* **api:** the inviter's words reach the member who was invited ([b277e28](https://github.com/BytechLabs/Texturion/commit/b277e2834f28b560975cbe07b3b0a3958d1d2f3e))
* **api:** the missed-call text is signed by the line that was rung ([fed1a7a](https://github.com/BytechLabs/Texturion/commit/fed1a7a06907f1db2d5829ab9f6b060a943f1638)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **api:** the notices you cannot afford to miss reach more than an inbox ([86b4064](https://github.com/BytechLabs/Texturion/commit/86b40645be8945f7752906cafdc2983dc03e3477)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **api:** the phone tells you the moment your number switches over ([78487ab](https://github.com/BytechLabs/Texturion/commit/78487ab78c15c26dd934f991f819eb92a49eaae8)), closes [#319](https://github.com/BytechLabs/Texturion/issues/319)
* **api:** the question goes out after a job, and a digit answers it ([056b62a](https://github.com/BytechLabs/Texturion/commit/056b62a4a5cc0b3eb6bcf3edfb95c2fc9ba461af))
* **api:** the same file stored once, and the number that says when to do more ([0325b9a](https://github.com/BytechLabs/Texturion/commit/0325b9a64ae56ed2008b761a2d23e587511bcaa5)), closes [#240](https://github.com/BytechLabs/Texturion/issues/240)
* **api:** the tag a greeting-capture call carries ([a9ac06f](https://github.com/BytechLabs/Texturion/commit/a9ac06f71ab29500f8631c24379e4d2042963990))
* **api:** the work can be taken away as a file ([515a9d2](https://github.com/BytechLabs/Texturion/commit/515a9d2c92ccf09c7ffd6d2de7c3c1427806dabc)), closes [#304](https://github.com/BytechLabs/Texturion/issues/304)
* **api:** voicemail recordings age out on the year we publish for them ([a91079c](https://github.com/BytechLabs/Texturion/commit/a91079c975f7b5100b8be3ef41ebb2f60f73abb5)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **api:** where this customer came from ([009be2b](https://github.com/BytechLabs/Texturion/commit/009be2b652ebf66667536ab53a1f4e0a66773577))
* **api:** work out when a job's reminders should go, and what they say ([ac498c5](https://github.com/BytechLabs/Texturion/commit/ac498c550eea68e9756caafe604b4df61526e1ff))
* **clients:** a call line says who picked it up ([f5b2df4](https://github.com/BytechLabs/Texturion/commit/f5b2df49038845567a816832591a06ac31fd9fbd)), closes [#517](https://github.com/BytechLabs/Texturion/issues/517)
* **clients:** a crew can choose the language their automated texts go out in ([55c366d](https://github.com/BytechLabs/Texturion/commit/55c366d718fb92a80a7e61025062ace05d40ef30))
* **clients:** a joining orientation, and a notification ask with a reason ([d87bf03](https://github.com/BytechLabs/Texturion/commit/d87bf03635b7119bf56cf65bbd6e2b988a9f4da9)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** a member is told a number is hidden, not left to guess ([11d9ad4](https://github.com/BytechLabs/Texturion/commit/11d9ad4e252ac8bb9168e29d4711c8cee1f45549)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** answer the reason somebody gives for leaving ([0109464](https://github.com/BytechLabs/Texturion/commit/0109464f7e43d9bc333282bc9753ff932e90fdc1))
* **clients:** being handed work reaches the phone, not just the bell ([e64b061](https://github.com/BytechLabs/Texturion/commit/e64b06158109a628296b992479e1c2d283f502f0)), closes [#515](https://github.com/BytechLabs/Texturion/issues/515)
* **clients:** catch up on a thread without Lou inventing anything ([21e57c0](https://github.com/BytechLabs/Texturion/commit/21e57c0243bd5cc7945be62c3dd691ca1d162533))
* **clients:** choose how loud each kind of notification is ([444ff1f](https://github.com/BytechLabs/Texturion/commit/444ff1f41cde9b0ea3c6bd741afb9103e659182c))
* **clients:** keep the number your plan covers when you come back ([ef37c6d](https://github.com/BytechLabs/Texturion/commit/ef37c6d58565582d0015bbf4798a5161bda78efb))
* **clients:** one tap says "I have this", and the other phones stop ([2ef5b88](https://github.com/BytechLabs/Texturion/commit/2ef5b88b984cf37b9779bd4677a7fa86ac44013c))
* **clients:** pause a plan for the winter without losing the number ([b1444d7](https://github.com/BytechLabs/Texturion/commit/b1444d75c3725f79baf591ab1fa3a9e8e3734688))
* **clients:** register US texting during a pause without being misled ([7f7017f](https://github.com/BytechLabs/Texturion/commit/7f7017f0bac2adde70107ed7c3fb5beee7e2a36f))
* **clients:** satisfaction sits beside response time, and refuses to guess ([94ae5ca](https://github.com/BytechLabs/Texturion/commit/94ae5ca3d0167d146bf88e67e400db1f38d411ff))
* **clients:** send later on both phones, and one place to see everything queued ([8987f1c](https://github.com/BytechLabs/Texturion/commit/8987f1cd7fa88dbe9b8efa6cb90692d80e867246))
* **clients:** set quiet hours without losing the night you are on call ([43c7b71](https://github.com/BytechLabs/Texturion/commit/43c7b71368ed0155f10b62c5da16a8e5b6594504))
* **clients:** switch reminders off for one job, and see who confirmed it ([1f782e3](https://github.com/BytechLabs/Texturion/commit/1f782e3464819b90408f4b9757a97812607a8027))
* **clients:** the phones can open the leads nobody answered ([bace185](https://github.com/BytechLabs/Texturion/commit/bace185b3444960ac3bcf877e41bf56c9d631ec5)), closes [#508](https://github.com/BytechLabs/Texturion/issues/508)
* **clients:** the uploader makes the preview, on all three ([a243318](https://github.com/BytechLabs/Texturion/commit/a243318aa6926af2ce43c0f3754da5edb6e930a2)), closes [#240](https://github.com/BytechLabs/Texturion/issues/240)
* **clients:** the voicemail greeting is the owner's words, with nothing appended ([3dc8ce5](https://github.com/BytechLabs/Texturion/commit/3dc8ce572bd74de6f9f0154effb39ec3d05ccf57)), closes [#518](https://github.com/BytechLabs/Texturion/issues/518)
* **db:** a customer can be found by what is in their custom fields ([6483a1b](https://github.com/BytechLabs/Texturion/commit/6483a1bfc7e2a29b32bfe20e5ce4fb2f06833015))
* **db:** a customer can have more than one number ([b2a064b](https://github.com/BytechLabs/Texturion/commit/b2a064bf8eb544cb408520f6405fbe90886ea81c))
* **db:** a finished job can ask the customer how it went ([475cc6b](https://github.com/BytechLabs/Texturion/commit/475cc6b22758682c52cb7cfe06a25d0b687dfa3e))
* **db:** a job can remind the customer it is coming ([a661a94](https://github.com/BytechLabs/Texturion/commit/a661a94a798224a0a771877fe3660aba884be0c9))
* **db:** a text can be written now and scheduled to send later ([737c72a](https://github.com/BytechLabs/Texturion/commit/737c72af5a908108b580d6054ebb7f5eb3eab8fd))
* **db:** a workspace can define the contact fields its trade actually needs ([7b7da24](https://github.com/BytechLabs/Texturion/commit/7b7da244de016d4aeba264775cb8b7325fafc737))
* **db:** applying the AUP ladder is recorded, whoever applies it ([a572cae](https://github.com/BytechLabs/Texturion/commit/a572caeaa228bd03f55e3549cea608d6d12aaa43)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **db:** notifications can be grouped instead of arriving one at a time ([3ace857](https://github.com/BytechLabs/Texturion/commit/3ace857b54322881f7797127a680d0b803568dbe))
* **db:** somebody holds the phone tonight, and an unanswered page widens ([97d8d3e](https://github.com/BytechLabs/Texturion/commit/97d8d3e412530dbe69ab85433d69ee08dae06be3))
* **db:** somewhere to keep a greeting in the owner's own voice ([c5d3aae](https://github.com/BytechLabs/Texturion/commit/c5d3aae99b70b5f2b9efd056bba29697070041b6))
* **db:** the carrier's own verdict joins the AUP signals ([cf639ff](https://github.com/BytechLabs/Texturion/commit/cf639ff4b268f9afe6a180b0314c72289e3414ef)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **db:** usage is one question about a window, not three about a period ([2d677eb](https://github.com/BytechLabs/Texturion/commit/2d677eb888dca7645a0777753172bebbacff692f)), closes [#304](https://github.com/BytechLabs/Texturion/issues/304)


### Bug Fixes

* **api:** a cancelled transfer stops billing you in silence for the stopgap ([4469c14](https://github.com/BytechLabs/Texturion/commit/4469c14eadb3462f24cfa3bfc4283d0e83f9fb73)), closes [#319](https://github.com/BytechLabs/Texturion/issues/319)
* **api:** a contact's language reads back after it is set ([8c68be6](https://github.com/BytechLabs/Texturion/commit/8c68be695cfd460f9da251b421e716d68ea3097f))
* **api:** a customer who texts ARRET is opted out, not answered ([824fab2](https://github.com/BytechLabs/Texturion/commit/824fab23ba699fee69c2974b68be84ceca04c4d6))
* **api:** a failed provisioning row no longer holds a number hostage ([c50a636](https://github.com/BytechLabs/Texturion/commit/c50a6361fd19824a288b607e55376f2f919af22c))
* **api:** a reminder cannot land at 5am ([88d55c6](https://github.com/BytechLabs/Texturion/commit/88d55c654dec7920ae22e282d2159ac5ccc8a988))
* **api:** a reply to a Loonext email reaches a person, on every deploy ([bfe715e](https://github.com/BytechLabs/Texturion/commit/bfe715e9c355a2fe09f45e2311206d6a2a188b40)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **api:** checkout charges a currency Stripe will actually accept ([7a644aa](https://github.com/BytechLabs/Texturion/commit/7a644aaaf1b8e340d41b86176c6f97795e08dca4))
* **api:** checkout now says when your crew won't fit the plan ([0d11b15](https://github.com/BytechLabs/Texturion/commit/0d11b15b59f6e7b83b546292438be91addb6377c)), closes [#523](https://github.com/BytechLabs/Texturion/issues/523)
* **api:** drop the zero-width space that failed lint ([eb7c5cc](https://github.com/BytechLabs/Texturion/commit/eb7c5ccd4a36616a4d517eec474232a5e17cba13))
* **api:** every send goes to the number the thread is with ([07bb322](https://github.com/BytechLabs/Texturion/commit/07bb322bf73d4bed321c5b3e94e57c628eed7db3))
* **api:** stop alerting that the platform is quiet when the platform is quiet ([b10dc46](https://github.com/BytechLabs/Texturion/commit/b10dc4651a993295968a8f4c0d015d56aa9a8f3f)), closes [#510](https://github.com/BytechLabs/Texturion/issues/510)
* **api:** tell the founder what to do about an alert, not just what broke ([e360281](https://github.com/BytechLabs/Texturion/commit/e3602811d8f0d7be7393525e39271a08ea0bff13))
* **api:** the cancellation reason was never actually being written ([de7c7ea](https://github.com/BytechLabs/Texturion/commit/de7c7ea9faf5739202c2d3cc5bc0452b42d7a811))
* **api:** the note reaches an admin, who never sees the orientation ([e19d2a0](https://github.com/BytechLabs/Texturion/commit/e19d2a0c8270a645def49153ef7d449889e2127b))
* **clients:** a Canadian workspace can buy an extra number again ([9b058f5](https://github.com/BytechLabs/Texturion/commit/9b058f5f96db82bee4eef17b0cd8c2672f8c4b49)), closes [#522](https://github.com/BytechLabs/Texturion/issues/522)
* **clients:** a role only reaches the settings its capabilities allow ([23ee9d1](https://github.com/BytechLabs/Texturion/commit/23ee9d1c617eb77cc9dedc7ffd7aa043660ccc09)), closes [#515](https://github.com/BytechLabs/Texturion/issues/515)
* **clients:** quote the currency the customer is actually charged in ([575f868](https://github.com/BytechLabs/Texturion/commit/575f8682db04eb5b7eccf8612834193fb69e2dad))
* **clients:** your usage screen quotes your own currency, not US dollars ([bb79892](https://github.com/BytechLabs/Texturion/commit/bb7989235a61c569e8c6065b8897ecc1496748c4)), closes [#522](https://github.com/BytechLabs/Texturion/issues/522)
* **web:** searching for a number by digits actually searches for it ([0cf1d20](https://github.com/BytechLabs/Texturion/commit/0cf1d20f1a590cfe2210958e88624452f1cd2694)), closes [#513](https://github.com/BytechLabs/Texturion/issues/513)

## [0.10.0](https://github.com/BytechLabs/Texturion/compare/api-v0.9.0...api-v0.10.0) (2026-08-02)


### Features

* **api:** a Canadian workspace can be billed in Canadian dollars ([0ea4335](https://github.com/BytechLabs/Texturion/commit/0ea4335856bd3d1acba811da1a72579b11195911))
* **api:** a contact says how long they have been one, and how often ([18f265e](https://github.com/BytechLabs/Texturion/commit/18f265e622a32f36209643386aa0ca85eb030cf0)), closes [#410](https://github.com/BytechLabs/Texturion/issues/410)
* **api:** a robotext stops waking the crew's phones at six in the morning ([e33ad35](https://github.com/BytechLabs/Texturion/commit/e33ad35796d90d1886129b6c3b817990759b02bc)), closes [#250](https://github.com/BytechLabs/Texturion/issues/250)
* **api:** a thread marked as spam stops spending the AI budget ([f53b9bd](https://github.com/BytechLabs/Texturion/commit/f53b9bd65778b06296028dca49f47e68a30eff61)), closes [#250](https://github.com/BytechLabs/Texturion/issues/250)
* **api:** a workspace can refuse a number, and clear a wrong suspicion ([948f826](https://github.com/BytechLabs/Texturion/commit/948f826435d685839d80b31acab670652e0c151c)), closes [#250](https://github.com/BytechLabs/Texturion/issues/250)
* **api:** say what a call was about instead of typing it out afterwards ([8d33b20](https://github.com/BytechLabs/Texturion/commit/8d33b20bcd77077d3ad71fd2b45a5af8f831d90f))
* **billing:** a workspace can buy a year, and the licensed line goes free ([96011f3](https://github.com/BytechLabs/Texturion/commit/96011f3a7087d7fc322086cc773a2173f90b355d))
* **billing:** the billing page offers a year, and the alert stops counting it ([702f34a](https://github.com/BytechLabs/Texturion/commit/702f34a03ab11d6d99f50694d2a55fa1f8f9384b))
* **compose:** a template can say the address, the time and who is coming ([39488a9](https://github.com/BytechLabs/Texturion/commit/39488a9c7352ef789a1529fb5c9959c5f511de17))
* **contacts:** the workspace can find its duplicates and fold them together ([fdb6144](https://github.com/BytechLabs/Texturion/commit/fdb6144006e5f5c18f198446ef432aff4c2e76ac))
* **db:** referrals get a table, and the referrer owns the row ([b07349d](https://github.com/BytechLabs/Texturion/commit/b07349d424eeeafd73dd2cd6614f134abf9838d2))
* **db:** the ledger records which revenue stream a charge belongs to ([e8fbabc](https://github.com/BytechLabs/Texturion/commit/e8fbabc365608a2156f521d1ab13004b8e3edee9)), closes [#506](https://github.com/BytechLabs/Texturion/issues/506)
* **inbox:** a filter can be saved under a name and kept ([d03bd00](https://github.com/BytechLabs/Texturion/commit/d03bd00e860df22f10f7ac65b57fb3f4eba27783))
* **inbox:** a saved reply now records that it was the one sent ([452bcd4](https://github.com/BytechLabs/Texturion/commit/452bcd4e6b907c810040ebdf1c0199a0775c7a62))
* **inbox:** a tag can say what it means, and there is a limit on how many ([6b9b85c](https://github.com/BytechLabs/Texturion/commit/6b9b85ce19d06beaf4a25228a6e557ab90b59070))
* **inbox:** a workspace can keep a set list of tags if it wants one ([1030bc1](https://github.com/BytechLabs/Texturion/commit/1030bc14ab48b8caf833ee07d16bf256690087bc))
* **inbox:** the phones can tidy tags too, and a crew can freeze the list ([1ebf918](https://github.com/BytechLabs/Texturion/commit/1ebf918a3b8ede21a6693718e43feca5e5c66ff3))
* **inbox:** the Quote sent list is waiting for you on Monday ([961cec0](https://github.com/BytechLabs/Texturion/commit/961cec07cb3d577adf283b4ed7799dafa04e68e8))
* **marketing:** the page a customer arrived through reaches their workspace ([8097fc0](https://github.com/BytechLabs/Texturion/commit/8097fc00c9920ddb08ecb2298bf706fcf695c0ce)), closes [#296](https://github.com/BytechLabs/Texturion/issues/296)
* **ops:** a report says which workspaces cost more than they pay ([ef83569](https://github.com/BytechLabs/Texturion/commit/ef83569a5df290ad97ed406a3bd478afa449765e))
* **referrals:** a qualified referral pays both sides a free month ([34383fc](https://github.com/BytechLabs/Texturion/commit/34383fcd16f2abbc841252947cc7bbbbcdbcd904))
* **referrals:** a signup can name who sent it, and a first text earns it ([25ed502](https://github.com/BytechLabs/Texturion/commit/25ed50255b41655035c39633420b71d56c5c03cc))
* **referrals:** the referrer can see their link and what it did ([932c090](https://github.com/BytechLabs/Texturion/commit/932c0907def800092d568dd61f0f6de7f6d014b4))
* **signup:** ask how big the crew is, because that is where our price wins ([9a40601](https://github.com/BytechLabs/Texturion/commit/9a406016ee2763934b004910aeb02783002699ed))
* **templates:** saved replies carry a category, and the picker leads with what you send ([ab952d1](https://github.com/BytechLabs/Texturion/commit/ab952d1db52b0e0cea7886dd237928fa4f4f4d20))

## [0.9.0](https://github.com/BytechLabs/Texturion/compare/api-v0.8.0...api-v0.9.0) (2026-08-01)


### Features

* **api:** billing is gated on the axis it means, not a rung on a ladder ([91fb03f](https://github.com/BytechLabs/Texturion/commit/91fb03f2db7f7530554a6e6ce857154b75014235)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **api:** mark, assign or delete a whole filtered task list in one call ([3fc2736](https://github.com/BytechLabs/Texturion/commit/3fc27362b6e7e295d63ab4031023029d1e42a19f))
* **api:** synthetic probes start checking auth and carrier callbacks ([c258278](https://github.com/BytechLabs/Texturion/commit/c2582781c23543fdc5cd447a4c61c19c3c18cd12))
* **billing:** a workspace can buy a year up front once it has sent something ([61855d0](https://github.com/BytechLabs/Texturion/commit/61855d03f4e8002ae69965dbccc1a9670fc51052))
* **billing:** tell the owner how many customers rang while their number was off ([29ee30f](https://github.com/BytechLabs/Texturion/commit/29ee30f5394a91f75001840e10c4532a4ee2fe41))
* **calls:** a caller on a suspended line hears one honest sentence ([8ebfbd7](https://github.com/BytechLabs/Texturion/commit/8ebfbd7d1067105ba34f664a8b323c73a1251dad))
* **clients:** add a view-only role for people who should see the work, not change it ([fc87232](https://github.com/BytechLabs/Texturion/commit/fc87232b2a780da17005b7139378ed5e7fec6bc7)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **clients:** only an owner or admin can change the crew's saved replies ([733b877](https://github.com/BytechLabs/Texturion/commit/733b87702ff1aa950f47190fce0646378ff306c3)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315) [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **dialer:** the keypad finds people by name, and can text them ([cdc149b](https://github.com/BytechLabs/Texturion/commit/cdc149b98f937682110075709b17355b3b9b31e1))
* **messaging:** a departing crew's customers hear where the business went ([23b5c17](https://github.com/BytechLabs/Texturion/commit/23b5c1729a2ccf9f87cdb32efdbd1bfbc0d49358))
* **reports:** the monthly response-time recap, and [#482](https://github.com/BytechLabs/Texturion/issues/482) is done ([eee896a](https://github.com/BytechLabs/Texturion/commit/eee896aaa07b152f92aa30355a91845f0f1e55c2))
* **reports:** the per-number response times finally have a reader ([4265c6e](https://github.com/BytechLabs/Texturion/commit/4265c6ee67d6530e564b31abaf9a591ed6493307))
* **settings:** a departing owner writes what their customers will hear ([5849489](https://github.com/BytechLabs/Texturion/commit/5849489d87eecce630f9f1c3232a016877124463))
* **web:** add a bookkeeper role that gets billing without the inbox ([27f133e](https://github.com/BytechLabs/Texturion/commit/27f133e1c6b67d7554426a895cfcadfc42b60eaa)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)


### Bug Fixes

* **api:** an audit row now says which setting moved, and what it was ([b046b8b](https://github.com/BytechLabs/Texturion/commit/b046b8bc050f17e59cad1dbc72d02009c372c500)), closes [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **api:** tell the owner when someone exports the whole workspace ([75e6355](https://github.com/BytechLabs/Texturion/commit/75e635509325a93f954fa615e6c0a97217de262f)), closes [#497](https://github.com/BytechLabs/Texturion/issues/497)
* **auth:** a second factor you turned on is now actually required ([f0f4946](https://github.com/BytechLabs/Texturion/commit/f0f49469a6f220b1b50ede39cd330c2bd012d3e4))
* **ios:** a view-only observer is not offered a call they cannot place ([53e4ffd](https://github.com/BytechLabs/Texturion/commit/53e4ffd82c9c53be2fd680ce6877b65037e82d24)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)


### Reverts

* **billing:** the prepaid year funded ten months, not twelve ([09f9446](https://github.com/BytechLabs/Texturion/commit/09f9446bd39bec28cd95c0b6d84dfca7be7be879))

## [0.8.0](https://github.com/BytechLabs/Texturion/compare/api-v0.7.0...api-v0.8.0) (2026-07-31)


### Features

* a carrier that revokes US texting no longer reads as approved ([ab81bad](https://github.com/BytechLabs/Texturion/commit/ab81bad6196125400feb02905420e3a413166afe)), closes [#423](https://github.com/BytechLabs/Texturion/issues/423)
* a failed text says why in plain terms, not a carrier's error number ([5e59ec0](https://github.com/BytechLabs/Texturion/commit/5e59ec0501143794d6179002a96e6b1903c3bebd)), closes [#241](https://github.com/BytechLabs/Texturion/issues/241)
* a switch that does not need a deploy, and a runbook for 2am ([52bae11](https://github.com/BytechLabs/Texturion/commit/52bae1104560bbe857221c9646f69c5976517e31)), closes [#283](https://github.com/BytechLabs/Texturion/issues/283)
* **alerts:** warn a crew before the carriers stop taking their texts ([50b44af](https://github.com/BytechLabs/Texturion/commit/50b44af7c26b7a290ef88779f904a4e874e5c3e7))
* **api:** a CSV import must say why those people agreed to be texted ([edfa044](https://github.com/BytechLabs/Texturion/commit/edfa044e36567ced5d395294b5fcb6ec53e74840)), closes [#226](https://github.com/BytechLabs/Texturion/issues/226)
* **api:** a second factor, and the recovery that makes it safe to turn on ([8a6e47e](https://github.com/BytechLabs/Texturion/commit/8a6e47e2e76e86421ce40b95ba82bf0b0b53f5b8))
* **api:** a signed-out device stops working on its next call, not its next hour ([11e49e7](https://github.com/BytechLabs/Texturion/commit/11e49e79f1fe66de44be00dd5762f740b3783ba5))
* **api:** a SIN fragment from a signup that never paid is cleared after 30 days ([8837796](https://github.com/BytechLabs/Texturion/commit/883779638a631e5a782058df446c43bd7929bda3)), closes [#381](https://github.com/BytechLabs/Texturion/issues/381)
* **api:** a workspace in a dispute keeps its data past its purge date ([a78cc32](https://github.com/BytechLabs/Texturion/commit/a78cc326b6e54de850ba1c36c74b2760b6c3ec8d)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **api:** a workspace is warned a month before its oldest texts age out ([1ed8538](https://github.com/BytechLabs/Texturion/commit/1ed8538302ee16dce0a518462efa9c36c0bd83a0)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **api:** act on every conversation matching a filter, in one call ([cb8f7dc](https://github.com/BytechLabs/Texturion/commit/cb8f7dc3ef1856ec07bc90630f8538c9f3a904e9))
* **api:** activation can be measured the way D12 defines it ([10f8bd3](https://github.com/BytechLabs/Texturion/commit/10f8bd354a07fc6fe89ab2b171db3481a592492c))
* **api:** an inbound outage is caught in hours, not half a day ([7ef23a6](https://github.com/BytechLabs/Texturion/commit/7ef23a66a334c871c879371d1d5c66e806845851)), closes [#308](https://github.com/BytechLabs/Texturion/issues/308)
* **api:** contact-form data from non-customers now ages out ([d4ff05b](https://github.com/BytechLabs/Texturion/commit/d4ff05bf82bf2e28d6ba04f1825f98f9b69dfe13)), closes [#340](https://github.com/BytechLabs/Texturion/issues/340)
* **api:** hand a workspace over, or name who takes it if you cannot ([3ee36a4](https://github.com/BytechLabs/Texturion/commit/3ee36a4c69b5fe51947807a6536161608e534bbb))
* **api:** high-priority push is a budget with a counter, a ceiling and an alert ([f74a29e](https://github.com/BytechLabs/Texturion/commit/f74a29e74dc46cd57673b50917a2f7da2623d66a)), closes [#452](https://github.com/BytechLabs/Texturion/issues/452) [#391](https://github.com/BytechLabs/Texturion/issues/391)
* **api:** let an owner sign first messages with the business name ([c9da4b5](https://github.com/BytechLabs/Texturion/commit/c9da4b5780492e4e921638b85f506fb26e34d421)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **api:** no automated text reaches a Texas number before noon on a Sunday ([3562bcb](https://github.com/BytechLabs/Texturion/commit/3562bcb4a98fedc4af177561ed17223c130a015d))
* **api:** notice a workspace stalling before it becomes a churn statistic ([079322c](https://github.com/BytechLabs/Texturion/commit/079322ca883abbc00aeb103a5f79ca0103cf3031)), closes [#281](https://github.com/BytechLabs/Texturion/issues/281)
* **api:** notice when inbound webhooks stop arriving ([a324e2e](https://github.com/BytechLabs/Texturion/commit/a324e2ef446b37f5852af46c843159edd0b3c98e)), closes [#308](https://github.com/BytechLabs/Texturion/issues/308)
* **api:** notice when one customer's calls stop arriving ([41ebba6](https://github.com/BytechLabs/Texturion/commit/41ebba63f722ffacd5130c2c8ed51de37e120fd6)), closes [#397](https://github.com/BytechLabs/Texturion/issues/397)
* **api:** one token model for pages a customer's customer opens ([130b24b](https://github.com/BytechLabs/Texturion/commit/130b24bb8b2efe050332b3a291c72e4590378c08)), closes [#335](https://github.com/BytechLabs/Texturion/issues/335)
* **api:** stop mailing addresses that bounce or report us as spam ([546e7b7](https://github.com/BytechLabs/Texturion/commit/546e7b7e3fbd191fc0d320bd47201e54169b2e47))
* **api:** the access rule can be asked why, not just what ([5f97e8b](https://github.com/BytechLabs/Texturion/commit/5f97e8bfbe75d4fbc9446a52b3b9564c635d26fd))
* **api:** the calls alarms prove every six hours that they can still speak ([d609bd0](https://github.com/BytechLabs/Texturion/commit/d609bd0856384c86cd2cb8bff6fc27ac39c04eff)), closes [#375](https://github.com/BytechLabs/Texturion/issues/375)
* **api:** the crew gets a push the moment their texting goes live ([73bd2b0](https://github.com/BytechLabs/Texturion/commit/73bd2b08f00cfbc51dc87ad0ba61bde5217a8d22)), closes [#310](https://github.com/BytechLabs/Texturion/issues/310)
* **api:** the crew signal and the mid-funnel span ([73ea358](https://github.com/BytechLabs/Texturion/commit/73ea358b60dc65fcb5f0694256d6ee2af3ff8316)), closes [#281](https://github.com/BytechLabs/Texturion/issues/281)
* **attachments:** a signed URL now says whether the browser may render the bytes ([a5151dd](https://github.com/BytechLabs/Texturion/commit/a5151ddf634741e02173c5a3404e6445e6c3e138)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **attachments:** a tech who sees something wrong can pull the file for everyone ([aaad5d5](https://github.com/BytechLabs/Texturion/commit/aaad5d5c38e191c59284a498b2ff15719cf547d9)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **attachments:** look inside the files we hand between strangers ([08fb569](https://github.com/BytechLabs/Texturion/commit/08fb5697b6aa9ae53a77b662d1da21103bfb5eb8)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **audit:** tell the owner when the contact list leaves ([1aee2ac](https://github.com/BytechLabs/Texturion/commit/1aee2acb45171af8948442fff4805397eaef5091))
* **billing:** a disputed charge is recorded, flagged and reported ([1950e39](https://github.com/BytechLabs/Texturion/commit/1950e39dfe7c308bbfe91c706f3364a59cc4f872))
* **billing:** cost the carrier alternatives, and name the second one ([b86ae52](https://github.com/BytechLabs/Texturion/commit/b86ae523aa4cb42ab690180827000708673b9ddd)), closes [#241](https://github.com/BytechLabs/Texturion/issues/241)
* **billing:** measure what an AI receptionist minute costs ([8bc3d79](https://github.com/BytechLabs/Texturion/commit/8bc3d796e6f9e81f73334f2d6ad6ef1bf84f4fd9)), closes [#397](https://github.com/BytechLabs/Texturion/issues/397)
* **calls:** give a call an address ([3a6b9ac](https://github.com/BytechLabs/Texturion/commit/3a6b9ac0f96ab115b3d5d0de46986490e6dd23fb))
* **calls:** the voicemail asks what the job is, and writes the answer down ([a6e3c26](https://github.com/BytechLabs/Texturion/commit/a6e3c26b0a4c8e1d53adbe36b5a73bf0f6e47961))
* **clients:** a crew member can see and fix their bouncing email address ([6f4b066](https://github.com/BytechLabs/Texturion/commit/6f4b066e082a0e57bf53ffbf55177dd8766c292a))
* **clients:** let an owner sign first texts, and count the signature ([176da2f](https://github.com/BytechLabs/Texturion/commit/176da2f4b1e9e244733da6424efad210ab5b27f2)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **compliance:** tell customers about the carrier's own daily ceiling ([c30f36c](https://github.com/BytechLabs/Texturion/commit/c30f36c1e7648cf6004344b04432d4d1f894b735))
* **contacts:** one history for a customer, instead of six threads to open ([37d0ab1](https://github.com/BytechLabs/Texturion/commit/37d0ab1e907b08ea300586e99e06e8619d8c1122)), closes [#324](https://github.com/BytechLabs/Texturion/issues/324)
* **db:** a consent ledger that writes itself ([aec6bb8](https://github.com/BytechLabs/Texturion/commit/aec6bb82282bd7011bfb43e42fed260443e4e74f)), closes [#226](https://github.com/BytechLabs/Texturion/issues/226)
* **focus:** remind me to chase this, if they haven't replied ([fd7a14d](https://github.com/BytechLabs/Texturion/commit/fd7a14d5b3356d088c97c2ee4eef3ff8a6bec94d)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **hours:** let a shop say it is closed on Christmas ([4e296eb](https://github.com/BytechLabs/Texturion/commit/4e296ebb940ff9019a88313e907525c2d060ecef))
* **inbox:** a thread you cannot act on yet can wait until Thursday ([b3dab0e](https://github.com/BytechLabs/Texturion/commit/b3dab0e064f2cb89219c91eccc16bac7551655e6)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **inbox:** give the crew a first screen written for them ([c885251](https://github.com/BytechLabs/Texturion/commit/c8852516251b303ac4c793ab5282100cdb7dbb61))
* **ios:** hand the workspace over, and ask for a backup owner once ([3616449](https://github.com/BytechLabs/Texturion/commit/361644944e9e9819091caadf5e9da18055bcf8f5))
* notice a number has gone bad before the customer does ([f03fb4a](https://github.com/BytechLabs/Texturion/commit/f03fb4a71d2c985bb736f3f38e2c5ce2138543a0)), closes [#235](https://github.com/BytechLabs/Texturion/issues/235)
* **notifications:** let a business keep customers' words off lock screens ([91242b3](https://github.com/BytechLabs/Texturion/commit/91242b36b1d6d50415ec6142847c613af5af85a3))
* **ops:** say whether we are keeping customers, or say nothing ([9bdf856](https://github.com/BytechLabs/Texturion/commit/9bdf85649f7bdb4c2d33393520b5ac0584861fc3)), closes [#327](https://github.com/BytechLabs/Texturion/issues/327)
* **ops:** support fixes get a dry run and a record, instead of psql ([0149d2d](https://github.com/BytechLabs/Texturion/commit/0149d2d403d5b7dfb1774790a8782bacce143319))
* **reports:** measure the first response we sell, and show the arc ([e337a89](https://github.com/BytechLabs/Texturion/commit/e337a89a7571501e36221c176ace56824bc63631)), closes [#239](https://github.com/BytechLabs/Texturion/issues/239)
* **search:** find a voicemail by what was said in it ([6f9b682](https://github.com/BytechLabs/Texturion/commit/6f9b682db4d9afa8a468052ff8d27d5d6573a9eb))
* **sending:** re-send the one message we can prove never left the building ([24c5de0](https://github.com/BytechLabs/Texturion/commit/24c5de09948e9adf9555b2b5fb85ab9d898b2be0))
* **settings:** the night trade can stop us asking, without us stopping the rule ([fbed55f](https://github.com/BytechLabs/Texturion/commit/fbed55f1d5193b8f12a04a65d58b9cad89babbb3)), closes [#225](https://github.com/BytechLabs/Texturion/issues/225)
* **snooze:** "needs attention, but on Thursday" gets a place to live ([2704227](https://github.com/BytechLabs/Texturion/commit/270422713a288b794049e32d442625b2e653d7b7)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **storage:** reclaim the two buckets nothing ever looked at, and probe the bytes ([ff25e8c](https://github.com/BytechLabs/Texturion/commit/ff25e8c3bb22b7e0e3c2afe7f6a59e8f52fdc5a5))
* **templates:** a saved reply can be recovered, and every change has a name ([3774cf9](https://github.com/BytechLabs/Texturion/commit/3774cf954216a56444646ee5eba3933f1fe4796b))
* the server learns what everyone is running, and can ask them to move ([c10bd41](https://github.com/BytechLabs/Texturion/commit/c10bd41e21063d21645ccee02332e1489f051059)), closes [#339](https://github.com/BytechLabs/Texturion/issues/339)
* the SIN is asked for after payment, not before ([4dc1811](https://github.com/BytechLabs/Texturion/commit/4dc1811d364f782cfbe7723b04c4252c8be677f7)), closes [#458](https://github.com/BytechLabs/Texturion/issues/458) [#381](https://github.com/BytechLabs/Texturion/issues/381)
* **web:** ask us to email you the comparison, and unsubscribe in one click ([d57f125](https://github.com/BytechLabs/Texturion/commit/d57f125a32069d462d40c7e81743be65b607197c)), closes [#312](https://github.com/BytechLabs/Texturion/issues/312)
* **web:** defer a thread, and a way back to everything you deferred ([590912e](https://github.com/BytechLabs/Texturion/commit/590912ea207c6b77b0b4dc9349f901ad78b89836)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **web:** the composer says what time it is where the customer is ([98ce03e](https://github.com/BytechLabs/Texturion/commit/98ce03e0607b84a32af7486f6b3d6b45fd7e7139))
* **web:** turn on two-factor, and don't lose the spare key ([9f2fa09](https://github.com/BytechLabs/Texturion/commit/9f2fa09ec977e0347687a13f3cc31218d336ad9b))


### Bug Fixes

* **alerts:** tell the owner when the crew's phones stop buzzing ([d11ab0f](https://github.com/BytechLabs/Texturion/commit/d11ab0f7f11b70c8ecc5cb3f6bef7bd00f22374d)), closes [#401](https://github.com/BytechLabs/Texturion/issues/401)
* **api:** a fresh import no longer queues behind every other workspace ([f8738aa](https://github.com/BytechLabs/Texturion/commit/f8738aa64c49c488c60313f6278cc7b94efe68ba)), closes [#440](https://github.com/BytechLabs/Texturion/issues/440)
* **api:** erasing a workspace now takes its data exports with it ([3657218](https://github.com/BytechLabs/Texturion/commit/3657218ce6fa5b001067242478ceab6ea0975ce7))
* **api:** see whether Lou's drafts get sent, not just what they cost ([53388aa](https://github.com/BytechLabs/Texturion/commit/53388aad4f4509889f320e07867e838f51e4e6f1)), closes [#431](https://github.com/BytechLabs/Texturion/issues/431)
* **api:** the calls kill switch now actually stops calls being placed ([5c44854](https://github.com/BytechLabs/Texturion/commit/5c44854c00a11061ac07e56a2dab950ca5f44cc1))
* **api:** the grace-notice tests typecheck again ([b642072](https://github.com/BytechLabs/Texturion/commit/b642072901f22ce45a9381ed2a311526a2897165))
* **attachments:** the allow-list matches the bucket, and a failed upload cleans up ([477f2dc](https://github.com/BytechLabs/Texturion/commit/477f2dc9be318705fed4db16ff4f958cf4d19a07)), closes [#262](https://github.com/BytechLabs/Texturion/issues/262)
* **billing:** checkout no longer wedges for a day, and a failed fee is withdrawn ([a828c81](https://github.com/BytechLabs/Texturion/commit/a828c81a5a6bfd053d75e7bc08896035449f6353))
* **calls:** the same people no longer miss every inbound call ([85e387c](https://github.com/BytechLabs/Texturion/commit/85e387ca23729d17d46c8b50fc8ae6ea406d6b7c))
* **clients:** a Canadian workspace can buy an extra number ([1ca1fde](https://github.com/BytechLabs/Texturion/commit/1ca1fde9a3adf83bd6a5761d2ab5d726b1985a6c)), closes [#464](https://github.com/BytechLabs/Texturion/issues/464)
* **compliance:** answer the Canadian A2P question, and aim it at the right mechanism ([4fbe10d](https://github.com/BytechLabs/Texturion/commit/4fbe10df9746e8acad88a0b42c2df49ccc98b4d5)), closes [#379](https://github.com/BytechLabs/Texturion/issues/379)
* **contacts:** page the history on the whole sort key, not just the clock ([a892b64](https://github.com/BytechLabs/Texturion/commit/a892b644015e77e195909bc34eb4fd733738c789)), closes [#324](https://github.com/BytechLabs/Texturion/issues/324)
* **messaging:** a crashed picture send no longer bills forever or retries short ([9b7584b](https://github.com/BytechLabs/Texturion/commit/9b7584be98bbd93f23410ee4eabde5d427cb4780)), closes [#263](https://github.com/BytechLabs/Texturion/issues/263)
* **messaging:** check inbound files against their bytes, and say when one is refused ([65bdff6](https://github.com/BytechLabs/Texturion/commit/65bdff6a46f83ba2377c2552b4bba6dde631814b)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **messaging:** the emergency reply stops assuming you are a plumber ([a01919b](https://github.com/BytechLabs/Texturion/commit/a01919b9a206088452a3241899ebf8ea54ae194c)), closes [#460](https://github.com/BytechLabs/Texturion/issues/460)
* tell a leaving customer their number goes to another business ([ed64782](https://github.com/BytechLabs/Texturion/commit/ed64782f4ba1d6b74abadcce9a7c3afcba790c20)), closes [#413](https://github.com/BytechLabs/Texturion/issues/413)
* telling the crew no longer waits for a two-minute buzz first ([01209b5](https://github.com/BytechLabs/Texturion/commit/01209b58f61d4b91749e259af62ca337f6bfcfa8)), closes [#463](https://github.com/BytechLabs/Texturion/issues/463)
* **test:** type the error envelope the quarantine test reads ([b508072](https://github.com/BytechLabs/Texturion/commit/b508072a293cc28847279f62a65875bd027084f5)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **web:** the shared-link preview stops advertising a design we retired ([14d1c31](https://github.com/BytechLabs/Texturion/commit/14d1c317ebb979aaa5027b60ca1e0453e521926c))
* **web:** the sub-processors page says what we actually send to AI ([218a254](https://github.com/BytechLabs/Texturion/commit/218a2541e23b6d670bb44a048fcddfb10c2f7c15))

## [0.7.0](https://github.com/BytechLabs/Texturion/compare/api-v0.6.0...api-v0.7.0) (2026-07-28)


### Features

* **api:** a crew member can now let themselves out of a workspace ([eea1a3c](https://github.com/BytechLabs/Texturion/commit/eea1a3cc78d65fa1bc01b52244137b37e8a2cedf))
* **api:** a customer who replies URGENT now gets an honest answer back ([ebe0511](https://github.com/BytechLabs/Texturion/commit/ebe0511fd50f6ee29bcd793011662e97df23c0a8))
* **api:** a flood of incoming texts stops being invisible ([fbcc14b](https://github.com/BytechLabs/Texturion/commit/fbcc14b7e0a09c9547431027eeb53f55f8ea976d))
* **api:** a number being taken off us is no longer silent ([4fb18f7](https://github.com/BytechLabs/Texturion/commit/4fb18f7e74cad7a584673f2f9b0e8dd2fa2c0f67))
* **api:** chase a new lead that nobody has answered yet ([6ea56df](https://github.com/BytechLabs/Texturion/commit/6ea56df3b4f1ce646765ae5b378664ea832bd462))
* **api:** replying URGENT now wakes the crew, because we said it would ([aae99d4](https://github.com/BytechLabs/Texturion/commit/aae99d4255028c0c372dca1ae4cedf75880b821b)), closes [#414](https://github.com/BytechLabs/Texturion/issues/414)
* **api:** show a crew whether their texts are actually arriving ([cf419d4](https://github.com/BytechLabs/Texturion/commit/cf419d4405681699dd583101f1dcb180703e40f0))
* **api:** tell the founder when something that should happen did not ([57f0311](https://github.com/BytechLabs/Texturion/commit/57f03110d04c9a695923f974fcfb5df64608b7e4))
* **api:** the founder hears when a customer costs more than they pay ([7b139cc](https://github.com/BytechLabs/Texturion/commit/7b139cc2f7396bb55b77d33e6e329fe488a025b1))
* **api:** the per-call dial fee gets the ceiling the spending cap cannot give it ([dc9e384](https://github.com/BytechLabs/Texturion/commit/dc9e38487182235cbc3fec4f67f87b99fa56431c))
* **api:** warn the crew when a customer has asked to be left alone ([80fa415](https://github.com/BytechLabs/Texturion/commit/80fa415cc9eea450ed8c3681249ffbf538650415))
* **api:** watch whether our texts actually land, split by which country ([520f5e9](https://github.com/BytechLabs/Texturion/commit/520f5e99acc21fca05d87ff5088ea6f3f8ca9d49))
* **api:** what Lou costs now counts toward whether a customer pays for itself ([1e55558](https://github.com/BytechLabs/Texturion/commit/1e555585b3b14cc175f2a2484900c6d266d496ef))
* **clients:** owners can turn lead chasing on or off everywhere ([440d57c](https://github.com/BytechLabs/Texturion/commit/440d57c4b659bf24ba0e29f89962edaee0fb3a43))
* **for-you:** anyone on the crew can pick up an unclaimed lead ([92fe855](https://github.com/BytechLabs/Texturion/commit/92fe8553d23be9cfef8a31fa68f03fb51b109ede))


### Bug Fixes

* **api:** a new lead now wakes the phone instead of waiting for Doze ([538dcf0](https://github.com/BytechLabs/Texturion/commit/538dcf0a8a8badd1018563e07ca23f0787058b2d))
* **api:** an away reply that is switched on always has something to say ([d9c734d](https://github.com/BytechLabs/Texturion/commit/d9c734dfe87644d4c64697fd05409e55191a4e98))
* **api:** saving a Lou setting works before you have written a description ([d7e0c1e](https://github.com/BytechLabs/Texturion/commit/d7e0c1e857f0455f944fc45e5d66c60bdea38f7b))
* **api:** someone who left the crew can be invited back ([4e91bf3](https://github.com/BytechLabs/Texturion/commit/4e91bf3f32bd4f83cea1dc1b8e7c1c7b10c82822))
* **api:** the cost of sending a text was a third lower than what we pay ([e36f21a](https://github.com/BytechLabs/Texturion/commit/e36f21aae3a37ad98049a57253daa9f4efb3f4b7))

## [0.6.0](https://github.com/BytechLabs/Texturion/compare/api-v0.5.0...api-v0.6.0) (2026-07-26)


### Features

* **api:** a STOP we never received still stops the texts ([9504283](https://github.com/BytechLabs/Texturion/commit/95042837194fef5c6cf05a24d72b251dc418aab3)), closes [#331](https://github.com/BytechLabs/Texturion/issues/331)
* **api:** deleting your data now gets you a confirmation in writing ([4a3b2cd](https://github.com/BytechLabs/Texturion/commit/4a3b2cd03032c31d4019ca5471cb6a6fd7bc957d)), closes [#371](https://github.com/BytechLabs/Texturion/issues/371)
* **web:** fix a customer's timezone when their area code has it wrong ([285932f](https://github.com/BytechLabs/Texturion/commit/285932f61a1b359444a9533db2be7415834b8a27)), closes [#292](https://github.com/BytechLabs/Texturion/issues/292)
* **web:** tell the crew when notifications are paused, not just the owner ([87807d9](https://github.com/BytechLabs/Texturion/commit/87807d96e6864ad6cd6481099b36d16f4d21467a)), closes [#343](https://github.com/BytechLabs/Texturion/issues/343)


### Bug Fixes

* **api:** notifications stop for the day when your day ends, not at 5pm ([c8f2b53](https://github.com/BytechLabs/Texturion/commit/c8f2b5330c4242dbff12d81c6e6332ce5f524f78)), closes [#343](https://github.com/BytechLabs/Texturion/issues/343)
* **web:** a customer wrongly marked as spam is no longer texting into silence ([5f0ebb0](https://github.com/BytechLabs/Texturion/commit/5f0ebb075e0f36f7e86ec0a8348204bbc986719a)), closes [#342](https://github.com/BytechLabs/Texturion/issues/342)

## [0.5.0](https://github.com/BytechLabs/Texturion/compare/api-v0.4.0...api-v0.5.0) (2026-07-26)


### Features

* **api:** ask for a copy of everything in your workspace ([da821e2](https://github.com/BytechLabs/Texturion/commit/da821e206b883d7e3688a3294b05bb96aefddccb)), closes [#227](https://github.com/BytechLabs/Texturion/issues/227)
* **api:** you can delete your own account, not just your workspace ([f9a3acf](https://github.com/BytechLabs/Texturion/commit/f9a3acf2c9e16016be975088f1a8ff566713a4e2)), closes [#346](https://github.com/BytechLabs/Texturion/issues/346)
* **web:** request and download your workspace export from settings ([cbffaae](https://github.com/BytechLabs/Texturion/commit/cbffaae4f1f023fb856958b33eb03c33a57951b8)), closes [#227](https://github.com/BytechLabs/Texturion/issues/227)

## [0.4.0](https://github.com/BytechLabs/Texturion/compare/api-v0.3.0...api-v0.4.0) (2026-07-26)


### Features

* **api:** a closed workspace is erased for real when its 30 days are up ([ef55506](https://github.com/BytechLabs/Texturion/commit/ef55506fc8e0739d1187badb4d4126ee928c0ee9)), closes [#341](https://github.com/BytechLabs/Texturion/issues/341)
* **api:** closing a workspace ends access at once and erases it in 30 days ([4cd817a](https://github.com/BytechLabs/Texturion/commit/4cd817acc132258913fc17a06e99f0158ec8dc15)), closes [#341](https://github.com/BytechLabs/Texturion/issues/341)

## [0.3.0](https://github.com/BytechLabs/Texturion/compare/api-v0.2.0...api-v0.3.0) (2026-07-26)


### Features

* **web:** removing someone asks where their work should go ([bb3594a](https://github.com/BytechLabs/Texturion/commit/bb3594a548f847d9fd90a98e3035953711a468bb)), closes [#276](https://github.com/BytechLabs/Texturion/issues/276)
* **web:** see who changed what in your workspace ([22aab61](https://github.com/BytechLabs/Texturion/commit/22aab6170686296030d968e5acb4a211fce41c34)), closes [#231](https://github.com/BytechLabs/Texturion/issues/231)

## [0.2.0](https://github.com/BytechLabs/Texturion/compare/api-v0.1.0...api-v0.2.0) (2026-07-26)


### Features

* a voicemail reads as a message in the conversation ([a03285c](https://github.com/BytechLabs/Texturion/commit/a03285c3ab496f2c95de151bbf3396b4ca871c4d))
* **api:** a task due date now reaches the phone it belongs to ([755278b](https://github.com/BytechLabs/Texturion/commit/755278b65f2275e176a5bdd586d48dbad08d5748))
* **api:** a task reminder arrives before the job is due, not on it ([c2171e2](https://github.com/BytechLabs/Texturion/commit/c2171e2715656d16b4c00db417609094cf11dfe6))
* **api:** a voicemail is written down as well as recorded ([d1b197a](https://github.com/BytechLabs/Texturion/commit/d1b197ac7222abc7ef43537b2267bc9d4804240a))
* **api:** name a teammate on a note and they get told ([a8ac02c](https://github.com/BytechLabs/Texturion/commit/a8ac02c73c808283b921835a1f903db9ddb271ae))
* tell Lou what your business does, in one sentence ([422aa0b](https://github.com/BytechLabs/Texturion/commit/422aa0b2cd7a4acba4db479b84a0d773a7ea608a))
* **web:** drafts offer to tell Lou what your business does ([41b682c](https://github.com/BytechLabs/Texturion/commit/41b682ced2dd991dfa9c60f314e0277b767b7c88))
* **web:** see how much Lou has done this month, before you run out ([2665b6a](https://github.com/BytechLabs/Texturion/commit/2665b6a7f13af8273fd3e9913ae1a326ec7532ec))
* **web:** the assistant has one look everywhere, and says why it came back empty ([27cf902](https://github.com/BytechLabs/Texturion/commit/27cf90271382e276c524f0848f10b95f0eb753ef))
* **web:** the composer can draft a reply you edit before sending ([3897ae6](https://github.com/BytechLabs/Texturion/commit/3897ae6435a9d322dbe4cdd1443c62ebc27360cd))
* **web:** type @ on a note to name a teammate ([a03c690](https://github.com/BytechLabs/Texturion/commit/a03c690bd2c6d1d38a9cc6e90dfd1fcb3c8871c2))


### Bug Fixes

* a contacts file from another tool imports from a phone too ([b74e149](https://github.com/BytechLabs/Texturion/commit/b74e1497ca834e545c7489ab41daec39e2472153))
* a voicemail that arrived without words gets them when you open it ([6a67ab5](https://github.com/BytechLabs/Texturion/commit/6a67ab54cd60e59fef308a1bbdd79d4d72c9c68e))
* **api:** a crash report no longer carries the caller's login token ([25fd5a7](https://github.com/BytechLabs/Texturion/commit/25fd5a76248684adb9442395a21880d77b3c83d4))
* **api:** a deadline from last month no longer arrives as a reminder ([65c00e5](https://github.com/BytechLabs/Texturion/commit/65c00e5e5501064174d995eb3fc47efb1899b4a0))
* **api:** a declined US registration fee cannot be charged twice ([794eaea](https://github.com/BytechLabs/Texturion/commit/794eaea9cd2c32053805693321e9073b86d80ccb))
* **api:** a developer's laptop no longer raises production-looking incidents ([9dc3363](https://github.com/BytechLabs/Texturion/commit/9dc3363540a1c6c872ff091546f798740c1dc7ee))
* **api:** a draft that names a date is no longer thrown away ([a52d673](https://github.com/BytechLabs/Texturion/commit/a52d673f9ac796b4f84d491b0b72dd5efcd638ae))
* **api:** a failed close of a declined fee invoice is tried again ([f95a9b1](https://github.com/BytechLabs/Texturion/commit/f95a9b1df2b3778a28d358fdd9191d62108109bb))
* **api:** a model that fails outright still falls back to the other one ([ec25ded](https://github.com/BytechLabs/Texturion/commit/ec25dedfd113510a8c9eba0374671496f3b9d656))
* **api:** a number whose release fails keeps being retried instead of aging out ([a3e121e](https://github.com/BytechLabs/Texturion/commit/a3e121e98dd1717ec6409ce8bc79a36deaa93953))
* **api:** a rejected task assignment no longer saves the rest of the edit ([b1f768d](https://github.com/BytechLabs/Texturion/commit/b1f768d6dc0d831177164843de3f9aaeb08a0fef))
* **api:** a removed member stops getting that workspace's reminders ([e181f9f](https://github.com/BytechLabs/Texturion/commit/e181f9fc54ca09b06f08050c1c080ec145ef5583))
* **api:** a retried call no longer rings the crew a second time ([6b65001](https://github.com/BytechLabs/Texturion/commit/6b65001ba55598f30e2002c5ffea298257acbbff))
* **api:** a send that times out mid-flight no longer texts twice ([e8897fc](https://github.com/BytechLabs/Texturion/commit/e8897fc435b8676207e671e6dacc178f76039eb8))
* **api:** a skipped import row points at the line you can actually see ([04fad20](https://github.com/BytechLabs/Texturion/commit/04fad2071941dede871d9ba3bb96f11a63be8392))
* **api:** a task reminder opens the job, not just the thread ([843fbf7](https://github.com/BytechLabs/Texturion/commit/843fbf7ab6e5cf44a4ab3ba740beaf6d47559990))
* **api:** a text to someone who opted out is refused, not attempted ([ab44fdf](https://github.com/BytechLabs/Texturion/commit/ab44fdf8bbda7c57d682a078356878e38fd7643f))
* **api:** a thread stays alerted when its assignee loses access to the number ([e365f5c](https://github.com/BytechLabs/Texturion/commit/e365f5cb6a8ebb38d4ab19e03e721257be7ade61))
* **api:** a US texting fee that succeeds on a retry now delivers it ([8f68410](https://github.com/BytechLabs/Texturion/commit/8f68410733f31e379b3d364282fcd7c4e7f106b7))
* **api:** a voicemail counts once against the monthly allowance ([a839d51](https://github.com/BytechLabs/Texturion/commit/a839d513fa4d47391a892ca055f3710a88a14fff))
* **api:** a voicemail is not transcribed again the first time it is played ([998881f](https://github.com/BytechLabs/Texturion/commit/998881f0620fcf011de5470bea56b189f69295bd))
* **api:** a voicemail is only marked tried once a model has answered ([128dc3d](https://github.com/BytechLabs/Texturion/commit/128dc3db7780483b70df7fc767cab1b305405ee2))
* **api:** a voicemail with nothing in it is only transcribed once ([b4abd6b](https://github.com/BytechLabs/Texturion/commit/b4abd6bda6a25ead8ab1cbf06986d7288e697f89))
* **api:** an empty set of drafts says which rule removed them ([12e81df](https://github.com/BytechLabs/Texturion/commit/12e81dfd9368625e00271786f7d00b1f286e4835))
* **api:** an incoming call rings every phone that should ring ([9660784](https://github.com/BytechLabs/Texturion/commit/9660784bac4118e1af66b76f7ec300001a01026b))
* **api:** drafted replies know the customer's name again ([f83ba50](https://github.com/BytechLabs/Texturion/commit/f83ba50ae36938fb5b0ab74121351505eb8eb5fa))
* **api:** drafted replies stop inventing a conversation that never happened ([80afc3a](https://github.com/BytechLabs/Texturion/commit/80afc3afde028fe7f1665a401c21ef1ed69c52a0))
* **api:** drafting works on a thread you already replied to ([28d9ff6](https://github.com/BytechLabs/Texturion/commit/28d9ff6c3f2fe7f08dfcb59ff89e92e47c21edca))
* **api:** drafts answer the customer, never our own messages ([267336e](https://github.com/BytechLabs/Texturion/commit/267336e8376fcc3174d9fe7754e948b3441151e0))
* **api:** drafts answer the newest message, and stop inventing the business ([116384b](https://github.com/BytechLabs/Texturion/commit/116384bbb3345b4d903a7d3ed3cf1712c02f565d))
* **api:** drafts from Lou stop disappearing before they reach you ([2fd002f](https://github.com/BytechLabs/Texturion/commit/2fd002f2d481ee0482a040e607e5f015d2c8a1fa))
* **api:** drafts reply to the customer, not to our own messages ([be9f5e5](https://github.com/BytechLabs/Texturion/commit/be9f5e52dbcbe1786708614d8eebc43aaf46b6a8))
* **api:** editing a contact no longer hides that they opted out ([5db4d70](https://github.com/BytechLabs/Texturion/commit/5db4d70b32dadd030e96a1112dcdd22f9ea80470))
* **api:** every byte a voicemail moves is counted ([d102014](https://github.com/BytechLabs/Texturion/commit/d1020144c25e8a5c563b2d9af890ce45bf67fdb3))
* **api:** exported phone numbers survive being opened in a spreadsheet ([a708117](https://github.com/BytechLabs/Texturion/commit/a70811720d388ac8eacb0cf6cf2ba7091cd876b9))
* **api:** hang up an outgoing call nothing authorized ([9da71bb](https://github.com/BytechLabs/Texturion/commit/9da71bb433944f03271be853a550cf73822b7ad7))
* **api:** importing a contact list can no longer unlock a customer's STOP ([db6664c](https://github.com/BytechLabs/Texturion/commit/db6664c64462fc54781f0f6af5ecd924c09dcd23))
* **api:** message responses stop publishing our carrier cost ([c3699ff](https://github.com/BytechLabs/Texturion/commit/c3699ffd57794539472270bd469d7e4dcc819b0a))
* **api:** one attachment can no longer use up a month of downloads ([f3b5fad](https://github.com/BytechLabs/Texturion/commit/f3b5fad5be746e47768144f6708ac7a34fbd5450)), closes [#261](https://github.com/BytechLabs/Texturion/issues/261)
* **api:** one member can no longer spend the whole crew's AI month ([9b53a33](https://github.com/BytechLabs/Texturion/commit/9b53a331fc15e65bc7b8ffc13b4155ecb0359f99))
* **api:** ordinary phrasing is no longer mistaken for a sales pitch ([193cde9](https://github.com/BytechLabs/Texturion/commit/193cde9eafa61ba7f3bbe86c12ccab3331bff070))
* **api:** read the model's answer whatever envelope it arrives in ([4084b64](https://github.com/BytechLabs/Texturion/commit/4084b64a79e79cd59d71b76e7a9a77df29ee4fdf))
* **api:** replaying an old checkout can no longer strand a canceled workspace ([f5e63e9](https://github.com/BytechLabs/Texturion/commit/f5e63e9997f54744327379c9adb4dda41ac92a5a))
* **api:** retrying a declined US registration fee actually charges it ([6f8d9ea](https://github.com/BytechLabs/Texturion/commit/6f8d9eaaa72efc61004e36bd53346bab3f66edff))
* **api:** saving a setting stops re-enabling in-app billing controls ([4950954](https://github.com/BytechLabs/Texturion/commit/4950954fc0e4ee45fe122c752a7da03b12e60a80))
* **api:** storage figures count voicemail recordings ([3f878de](https://github.com/BytechLabs/Texturion/commit/3f878de66fca60b5a5bb2b6211e4c84d8643f45f))
* **api:** task reminders name which message carries completion ([34b1f1e](https://github.com/BytechLabs/Texturion/commit/34b1f1ea8e2d42eea6ecf1f4b0477b9660bcc686))
* **api:** texting is not cut off early after a missed renewal ([c0155e8](https://github.com/BytechLabs/Texturion/commit/c0155e894477006c3f2224aa29f6c151411df883))
* **api:** the contacts list finds a number written any way too ([23e8a33](https://github.com/BytechLabs/Texturion/commit/23e8a33d0a7b5e7d01328f4bb463a102775385bd))
* **api:** the monthly AI allowance counts each request once ([32027bc](https://github.com/BytechLabs/Texturion/commit/32027bc28e6b5cf337397b3bbf97e30acbd232e2))
* **api:** three drafts come back instead of one ([c30b7cb](https://github.com/BytechLabs/Texturion/commit/c30b7cb026b9330dc04cb38701b34702ba4bc687))
* **api:** two overlapping runs cannot both send one reminder ([473ea08](https://github.com/BytechLabs/Texturion/commit/473ea082e0b7535c5dae14e2ebaa671317ae101c))
* **api:** voicemail downloads count against the download allowance ([d80f9e2](https://github.com/BytechLabs/Texturion/commit/d80f9e2e483d1d1f19c604eed10bf9f883ccc0a2))
* only the customer can undo a STOP, and we now say so ([4ea1b20](https://github.com/BytechLabs/Texturion/commit/4ea1b203eee3b251d561598614b0a6a9ffa6f1c6))
* **push:** a call that ends leaves an answer, not a silent alert ([d36dfec](https://github.com/BytechLabs/Texturion/commit/d36dfec50b9b1ca5e7dc9557a63458830b5e1b6e)), closes [#264](https://github.com/BytechLabs/Texturion/issues/264) [#265](https://github.com/BytechLabs/Texturion/issues/265)
* **push:** the whole crew gets the alert, and a mention is never erased ([4a23ef7](https://github.com/BytechLabs/Texturion/commit/4a23ef7d5768c4ff6ca27eaf20c2412d56d97175)), closes [#266](https://github.com/BytechLabs/Texturion/issues/266) [#267](https://github.com/BytechLabs/Texturion/issues/267)
* **web:** a password you set after signing in with Google shows as linked ([438173e](https://github.com/BytechLabs/Texturion/commit/438173e457578216072d460d0cc84481c619f984))
* **web:** an internal note can contain an email address again ([f37ee18](https://github.com/BytechLabs/Texturion/commit/f37ee1839141dd92eaff25ed973a9e4b8a8c68b1))
* **web:** storage counts voicemail recordings and names every kind ([56ba7d2](https://github.com/BytechLabs/Texturion/commit/56ba7d286280b2bf37a57c9c55e03c07cae222f1))


### Performance

* **api:** transcribe voicemails on a better model, without the memory spike ([785b63e](https://github.com/BytechLabs/Texturion/commit/785b63e9bc67db5f0de210f2e2f6d4e02d3ad339))
