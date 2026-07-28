# Changelog

## [0.7.0](https://github.com/BytechLabs/Texturion/compare/web-v0.6.0...web-v0.7.0) (2026-07-28)


### Features

* **api:** a crew member can now let themselves out of a workspace ([eea1a3c](https://github.com/BytechLabs/Texturion/commit/eea1a3cc78d65fa1bc01b52244137b37e8a2cedf))
* **api:** a customer who replies URGENT now gets an honest answer back ([ebe0511](https://github.com/BytechLabs/Texturion/commit/ebe0511fd50f6ee29bcd793011662e97df23c0a8))
* **api:** show a crew whether their texts are actually arriving ([cf419d4](https://github.com/BytechLabs/Texturion/commit/cf419d4405681699dd583101f1dcb180703e40f0))
* **api:** warn the crew when a customer has asked to be left alone ([80fa415](https://github.com/BytechLabs/Texturion/commit/80fa415cc9eea450ed8c3681249ffbf538650415))
* **clients:** owners can turn lead chasing on or off everywhere ([440d57c](https://github.com/BytechLabs/Texturion/commit/440d57c4b659bf24ba0e29f89962edaee0fb3a43))
* **for-you:** anyone on the crew can pick up an unclaimed lead ([92fe855](https://github.com/BytechLabs/Texturion/commit/92fe8553d23be9cfef8a31fa68f03fb51b109ede))
* **settings:** the away reply now warns when it asks for a word nothing hears ([28b0076](https://github.com/BytechLabs/Texturion/commit/28b00768b2add4aaeffda30941f24fea437a800d))
* **web:** a customer signed in can finally reach a person ([b58108c](https://github.com/BytechLabs/Texturion/commit/b58108c7b578b3dc44608f472e275b7bafe84eab))


### Bug Fixes

* **api:** an away reply that is switched on always has something to say ([d9c734d](https://github.com/BytechLabs/Texturion/commit/d9c734dfe87644d4c64697fd05409e55191a4e98))

## [0.6.0](https://github.com/BytechLabs/Texturion/compare/web-v0.5.0...web-v0.6.0) (2026-07-26)


### Features

* **api:** a STOP we never received still stops the texts ([9504283](https://github.com/BytechLabs/Texturion/commit/95042837194fef5c6cf05a24d72b251dc418aab3)), closes [#331](https://github.com/BytechLabs/Texturion/issues/331)
* **api:** deleting your data now gets you a confirmation in writing ([4a3b2cd](https://github.com/BytechLabs/Texturion/commit/4a3b2cd03032c31d4019ca5471cb6a6fd7bc957d)), closes [#371](https://github.com/BytechLabs/Texturion/issues/371)
* **web:** fix a customer's timezone when their area code has it wrong ([285932f](https://github.com/BytechLabs/Texturion/commit/285932f61a1b359444a9533db2be7415834b8a27)), closes [#292](https://github.com/BytechLabs/Texturion/issues/292)
* **web:** tell the crew when notifications are paused, not just the owner ([87807d9](https://github.com/BytechLabs/Texturion/commit/87807d96e6864ad6cd6481099b36d16f4d21467a)), closes [#343](https://github.com/BytechLabs/Texturion/issues/343)


### Bug Fixes

* **web:** a customer wrongly marked as spam is no longer texting into silence ([5f0ebb0](https://github.com/BytechLabs/Texturion/commit/5f0ebb075e0f36f7e86ec0a8348204bbc986719a)), closes [#342](https://github.com/BytechLabs/Texturion/issues/342)
* **web:** the home screen counts the work, not the twenty rows on screen ([3ab282d](https://github.com/BytechLabs/Texturion/commit/3ab282df7ed79f6048237ef1d49468c91b01e414)), closes [#306](https://github.com/BytechLabs/Texturion/issues/306)

## [0.5.0](https://github.com/BytechLabs/Texturion/compare/web-v0.4.0...web-v0.5.0) (2026-07-26)


### Features

* **web:** a public page explaining how to delete your data ([f7e3398](https://github.com/BytechLabs/Texturion/commit/f7e3398aa5a793aa817005264887f9b593ddd6f6)), closes [#227](https://github.com/BytechLabs/Texturion/issues/227)
* **web:** delete your own account from account settings ([d6db82b](https://github.com/BytechLabs/Texturion/commit/d6db82b9f9f528a4199d0e92d9e38ebd5458a228)), closes [#346](https://github.com/BytechLabs/Texturion/issues/346)
* **web:** request and download your workspace export from settings ([cbffaae](https://github.com/BytechLabs/Texturion/commit/cbffaae4f1f023fb856958b33eb03c33a57951b8)), closes [#227](https://github.com/BytechLabs/Texturion/issues/227)

## [0.4.0](https://github.com/BytechLabs/Texturion/compare/web-v0.3.0...web-v0.4.0) (2026-07-26)


### Features

* **web:** closing your workspace tells you what that means first ([a8d1a74](https://github.com/BytechLabs/Texturion/commit/a8d1a74f306a38628651a10db7d8e78aed9419dd)), closes [#341](https://github.com/BytechLabs/Texturion/issues/341)

## [0.3.0](https://github.com/BytechLabs/Texturion/compare/web-v0.2.0...web-v0.3.0) (2026-07-26)


### Features

* **web:** removing someone asks where their work should go ([bb3594a](https://github.com/BytechLabs/Texturion/commit/bb3594a548f847d9fd90a98e3035953711a468bb)), closes [#276](https://github.com/BytechLabs/Texturion/issues/276)
* **web:** see who changed what in your workspace ([22aab61](https://github.com/BytechLabs/Texturion/commit/22aab6170686296030d968e5acb4a211fce41c34)), closes [#231](https://github.com/BytechLabs/Texturion/issues/231)

## [0.2.0](https://github.com/BytechLabs/Texturion/compare/web-v0.1.0...web-v0.2.0) (2026-07-26)


### Features

* a text that fails now says why ([3316f9d](https://github.com/BytechLabs/Texturion/commit/3316f9da9f68a688f970ecff861ddea5d7a79382))
* a voicemail reads as a message in the conversation ([a03285c](https://github.com/BytechLabs/Texturion/commit/a03285c3ab496f2c95de151bbf3396b4ca871c4d))
* ask Lou for another set of drafts without starting over ([a9f6983](https://github.com/BytechLabs/Texturion/commit/a9f698324346a766727fded6ff0d8832cc0ea414))
* drafts are kept instead of re-asked for ([6882b49](https://github.com/BytechLabs/Texturion/commit/6882b493eeb2131c3a4cb40e3f47c0d32afb024a))
* settings shows which version you are running ([c65407e](https://github.com/BytechLabs/Texturion/commit/c65407e47323323139a3aba842798b6e1f2eb8ea))
* tell Lou what your business does, in one sentence ([422aa0b](https://github.com/BytechLabs/Texturion/commit/422aa0b2cd7a4acba4db479b84a0d773a7ea608a))
* the app icon is the dark tile on every platform ([90368d7](https://github.com/BytechLabs/Texturion/commit/90368d7436cac1283cad137a2175432ddb58b908))
* the assistant is called Lou ([3d40bf7](https://github.com/BytechLabs/Texturion/commit/3d40bf782b1ac730d60da3d73435d80c52509dcb))
* the blocked composer says who can unblock it ([790cf5a](https://github.com/BytechLabs/Texturion/commit/790cf5af2cbbb5cd0a861eb78e584e0385931994))
* **web:** a half-typed reply is still there when you come back ([e82f32f](https://github.com/BytechLabs/Texturion/commit/e82f32f9f4db11fc705d94e672fb95c04e5ab66a))
* **web:** add a contact without building a file for it ([341e3f9](https://github.com/BytechLabs/Texturion/commit/341e3f97a116153673f8dab08b35d4838f1e95f9))
* **web:** drafts offer to tell Lou what your business does ([41b682c](https://github.com/BytechLabs/Texturion/commit/41b682ced2dd991dfa9c60f314e0277b767b7c88))
* **web:** filter the call log down to voicemails ([2ae3c78](https://github.com/BytechLabs/Texturion/commit/2ae3c788c15a29f3bd21a76b630d0b2ef35f23dd))
* **web:** put a conversation back in the unread pile ([ecb148a](https://github.com/BytechLabs/Texturion/commit/ecb148aaf71e0c8b7b5aeb5a555a0c459401d28d))
* **web:** read a voicemail instead of playing it ([c9b27a2](https://github.com/BytechLabs/Texturion/commit/c9b27a2eb50f9fc0d12bc555dea47dabb130dd1b))
* **web:** see how much Lou has done this month, before you run out ([2665b6a](https://github.com/BytechLabs/Texturion/commit/2665b6a7f13af8273fd3e9913ae1a326ec7532ec))
* **web:** see what a merge field will actually say before you send ([b96fa2d](https://github.com/BytechLabs/Texturion/commit/b96fa2d1deca3f9c904a08d520c3587d9ced440a))
* **web:** set the spending cap by dragging, and watch where sending pauses ([4fb62e3](https://github.com/BytechLabs/Texturion/commit/4fb62e3b06116c4d3f3fc9976a54c84edda49f84))
* **web:** setting up shows the progress you have already made ([1f55ef5](https://github.com/BytechLabs/Texturion/commit/1f55ef536a33b49017f6a161f8fc42e934533fe9))
* **web:** the assistant has one look everywhere, and says why it came back empty ([27cf902](https://github.com/BytechLabs/Texturion/commit/27cf90271382e276c524f0848f10b95f0eb753ef))
* **web:** the composer can draft a reply you edit before sending ([3897ae6](https://github.com/BytechLabs/Texturion/commit/3897ae6435a9d322dbe4cdd1443c62ebc27360cd))
* **web:** the dialer names the customer you are calling ([5ab4f8c](https://github.com/BytechLabs/Texturion/commit/5ab4f8c9d0dd51e2bfed3a3b00428d1b6d5b7cbd))
* **web:** the home page reads as a dashboard instead of one long list ([28480dc](https://github.com/BytechLabs/Texturion/commit/28480dca47149f89cb55b5a173aeee73b63e7fef))
* **web:** the login screen remembers how you signed in last ([a15a5fd](https://github.com/BytechLabs/Texturion/commit/a15a5fdee6444bdf62c5a44714ec878202012ba1))
* **web:** the notification list offers to turn notifications on ([58df230](https://github.com/BytechLabs/Texturion/commit/58df23009c9f95b67064df3796692e0ce3754376))
* **web:** the spending cap looks like the decision it is ([30fbaad](https://github.com/BytechLabs/Texturion/commit/30fbaad123f354c9a6431975e82cb3ac00463580))
* **web:** type @ on a note to name a teammate ([a03c690](https://github.com/BytechLabs/Texturion/commit/a03c690bd2c6d1d38a9cc6e90dfd1fcb3c8871c2))


### Bug Fixes

* a contacts file from another tool imports from a phone too ([b74e149](https://github.com/BytechLabs/Texturion/commit/b74e1497ca834e545c7489ab41daec39e2472153))
* a voicemail that arrived without words gets them when you open it ([6a67ab5](https://github.com/BytechLabs/Texturion/commit/6a67ab54cd60e59fef308a1bbdd79d4d72c9c68e))
* only the customer can undo a STOP, and we now say so ([4ea1b20](https://github.com/BytechLabs/Texturion/commit/4ea1b203eee3b251d561598614b0a6a9ffa6f1c6))
* **push:** a call that ends leaves an answer, not a silent alert ([d36dfec](https://github.com/BytechLabs/Texturion/commit/d36dfec50b9b1ca5e7dc9557a63458830b5e1b6e)), closes [#264](https://github.com/BytechLabs/Texturion/issues/264) [#265](https://github.com/BytechLabs/Texturion/issues/265)
* **push:** the whole crew gets the alert, and a mention is never erased ([4a23ef7](https://github.com/BytechLabs/Texturion/commit/4a23ef7d5768c4ff6ca27eaf20c2412d56d97175)), closes [#266](https://github.com/BytechLabs/Texturion/issues/266) [#267](https://github.com/BytechLabs/Texturion/issues/267)
* reading one notification no longer marks the rest read ([eb2302c](https://github.com/BytechLabs/Texturion/commit/eb2302cc918fda93627438aa32dff9e3e44ccdef))
* suggested drafts clear once you type something new ([e9cfbaa](https://github.com/BytechLabs/Texturion/commit/e9cfbaa8bb8627f9574c344ab28ad9fe355b1b92))
* **web:** 6 round-4 fixes — a call reported but never placed, a permanent dead-end gate ([de385cf](https://github.com/BytechLabs/Texturion/commit/de385cf9d8d2921c4dd08e4f30130ebe19d934a5))
* **web:** a browser that cannot take calls says so instead of connecting forever ([7d79a4e](https://github.com/BytechLabs/Texturion/commit/7d79a4e213008ddec38804c74a492b8150486fba))
* **web:** a failed done or pin no longer deletes a message that just arrived ([4402d92](https://github.com/BytechLabs/Texturion/commit/4402d9229ab9d5f5c1ed6451744cb2b7a072a254))
* **web:** a finished call no longer lingers as ongoing ([2952e8a](https://github.com/BytechLabs/Texturion/commit/2952e8ac7f052c5098973c3fc2a7a9a294e186d9))
* **web:** a finished setup step reads as done rather than faded ([54c8a15](https://github.com/BytechLabs/Texturion/commit/54c8a15244642c9c874bcc06d9ebabf80222af67))
* **web:** a hovered row is plainly lit in light mode ([84f91d0](https://github.com/BytechLabs/Texturion/commit/84f91d0e38f9bbc5a2beb13c4de5e3c92c959009))
* **web:** a password you set after signing in with Google shows as linked ([438173e](https://github.com/BytechLabs/Texturion/commit/438173e457578216072d460d0cc84481c619f984))
* **web:** a photo can be posted to a task without writing a caption ([ab2771c](https://github.com/BytechLabs/Texturion/commit/ab2771ccdb8413fedba63aa5721f93fc198af6fd))
* **web:** a realtime gap is backfilled even when the first join failed ([75a76ca](https://github.com/BytechLabs/Texturion/commit/75a76ca4367225ff833a85f6fe9b62a42a43ac37))
* **web:** a sent message stops falling back to "Sending…" and staying there ([22473b0](https://github.com/BytechLabs/Texturion/commit/22473b0e5d4785f76a40ee543ecb9b677cf0b133))
* **web:** a task list that fails to load offers a retry ([0fd47bc](https://github.com/BytechLabs/Texturion/commit/0fd47bca14bf131baa7aa9e42fa47f95a0449300))
* **web:** a task you cannot complete says so instead of asking you to retry ([49c1674](https://github.com/BytechLabs/Texturion/commit/49c167417e3d3c1a57a5bf11563ff67f5de1ede5))
* **web:** a thread waiting on you counts once, not twice ([76209c5](https://github.com/BytechLabs/Texturion/commit/76209c5431f111ec109ef5f221c15aa75af568b1))
* **web:** a voice message now plays right in the conversation ([0a87bfa](https://github.com/BytechLabs/Texturion/commit/0a87bfa99ab4bfbb04b466dd2e3b8a1cfbfb00cb))
* **web:** a voicemail no longer shows its transcript twice ([3ac7165](https://github.com/BytechLabs/Texturion/commit/3ac71657f2d74d1e921818ef2a91bcd4c5183764))
* **web:** a workspace without US texting is told what to turn on ([36f872b](https://github.com/BytechLabs/Texturion/commit/36f872b6a7d42f572d8c139fdf3f076225fb7c73))
* **web:** an automation says when it cannot reach US numbers yet ([467cbb8](https://github.com/BytechLabs/Texturion/commit/467cbb8294e6a402571494901bb5446716e2d1c9))
* **web:** an internal note can contain an email address again ([f37ee18](https://github.com/BytechLabs/Texturion/commit/f37ee1839141dd92eaff25ed973a9e4b8a8c68b1))
* **web:** clearing a task address can be undone ([ea36cb9](https://github.com/BytechLabs/Texturion/commit/ea36cb98e5aab7e5ec448b7495466a5cc32cd0a8))
* **web:** editing a due date no longer wipes it halfway through ([9bc11f3](https://github.com/BytechLabs/Texturion/commit/9bc11f3fcba3574ebd6b41f474a231dadafe792f))
* **web:** notification settings name everything the push switch controls ([f24cbe2](https://github.com/BytechLabs/Texturion/commit/f24cbe21766ad85fdc34a5bf9f7570793305f643))
* **web:** reading a pinned conversation clears its unread dot ([16c50c9](https://github.com/BytechLabs/Texturion/commit/16c50c957026ab905f7a21780696f842fb8efd20))
* **web:** retrying a failed text no longer sends it to the customer twice ([9877aa8](https://github.com/BytechLabs/Texturion/commit/9877aa886f5d5c70a73c974a31a3d7d5c2611873))
* **web:** setting up no longer strands you on a screen that never loads ([62207de](https://github.com/BytechLabs/Texturion/commit/62207de6cae2e84940f431f0543961f8efbeac6b)), closes [#257](https://github.com/BytechLabs/Texturion/issues/257)
* **web:** setup stops calling itself live while a step is finishing ([17312bd](https://github.com/BytechLabs/Texturion/commit/17312bd79fd3b1b76fc646cac1c5c641e1554d0c))
* **web:** storage counts voicemail recordings and names every kind ([56ba7d2](https://github.com/BytechLabs/Texturion/commit/56ba7d286280b2bf37a57c9c55e03c07cae222f1))
* **web:** task rows in the focus queue light up under the pointer ([e905896](https://github.com/BytechLabs/Texturion/commit/e9058965891acc399b27806744cf1358f5859dde))
* **web:** the "Attachments sent" slice is visible in the storage breakdown ([e2ccd80](https://github.com/BytechLabs/Texturion/commit/e2ccd80f6728a4694ecd754d3771886f5e43fdf3))
* **web:** the calendar's open and done tabs actually filter it ([a3b1e38](https://github.com/BytechLabs/Texturion/commit/a3b1e3816fa85f70b542194d7727eec827292b40))
* **web:** the inbox says what kind of attachment arrived ([d24fc18](https://github.com/BytechLabs/Texturion/commit/d24fc184833d84b39229cec96ee8240982af5665))
* **web:** the parts count now includes what an attachment costs ([4d0f875](https://github.com/BytechLabs/Texturion/commit/4d0f875e7a73c042eed8b9a4f9195bf5cdd8a7ea))
* **web:** the registration wait names calling among what already works ([0588a77](https://github.com/BytechLabs/Texturion/commit/0588a77e6f1848e927b1b280fae791d21076f456))
* **web:** the US-approval wait offers the call that still works ([02dd05f](https://github.com/BytechLabs/Texturion/commit/02dd05fa52c5a1a8818fed366dcaaf52f066e38d))
* **web:** the Voicemail filter is fully visible on a phone ([349275c](https://github.com/BytechLabs/Texturion/commit/349275c839f0f57a339104dc11f0b052b346ae42))
* **web:** typing a number finds a customer beyond the first page ([0e816ae](https://github.com/BytechLabs/Texturion/commit/0e816ae75d04e7fb5e2f9f662734a237869b6d11))


### Performance

* **web:** loading a page asks for the focus queue twice, not six times ([e19e158](https://github.com/BytechLabs/Texturion/commit/e19e158b99552003361da8316cc37d7283764e52))
* **web:** opening the app stops firing the same request 27 times ([4897c7b](https://github.com/BytechLabs/Texturion/commit/4897c7b6fbd85fbe1787b7484f829e9940abb781))
* **web:** the calling SDK loads once the page is settled, not during it ([e757ad3](https://github.com/BytechLabs/Texturion/commit/e757ad36c3fb2338ae0774d6550081467f13c8ec))
