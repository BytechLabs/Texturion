# Changelog

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
