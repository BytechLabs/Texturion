# Changelog

## [0.17.3](https://github.com/BytechLabs/Texturion/compare/web-v0.17.2...web-v0.17.3) (2026-08-19)


### Bug Fixes

* **web:** the "Text us" widget speaks the language the business sells in ([39b209f](https://github.com/BytechLabs/Texturion/commit/39b209f28fbf53015c231ab0a41963b93259ab49))

## [0.17.2](https://github.com/BytechLabs/Texturion/compare/web-v0.17.1...web-v0.17.2) (2026-08-19)


### Bug Fixes

* **web:** name every do-not-text spelling the importer actually accepts ([58d154e](https://github.com/BytechLabs/Texturion/commit/58d154e88bdfabcc63032f9c6ed9883817fc7442))

## [0.17.1](https://github.com/BytechLabs/Texturion/compare/web-v0.17.0...web-v0.17.1) (2026-08-18)


### Bug Fixes

* **web:** three legal pages answered 500 to everyone who opened them ([ccf69f2](https://github.com/BytechLabs/Texturion/commit/ccf69f24141e33f1418a80342fddb9b815c27ba4))

## [0.17.0](https://github.com/BytechLabs/Texturion/compare/web-v0.16.0...web-v0.17.0) (2026-08-17)


### Features

* **api:** a push notification can be composed in the reader's language ([4e4f58f](https://github.com/BytechLabs/Texturion/commit/4e4f58fa34668177c1845e812a5d055c1aa0c7f6))
* **clients:** a held message says why in the reader's language ([2d811ba](https://github.com/BytechLabs/Texturion/commit/2d811baca33fe7c8a5b566c285904543b6ed2c53))
* **clients:** universal links open the app, for the paths the app can render ([1450aa3](https://github.com/BytechLabs/Texturion/commit/1450aa3c033c40e79a313d3c4b57227cc9cc20f2))
* **contacts:** the address list speaks French on Android too ([d6b5e19](https://github.com/BytechLabs/Texturion/commit/d6b5e19b9e776d09eec8c243a697359350046292))
* **contacts:** the phone list speaks French on Android too ([2a175bb](https://github.com/BytechLabs/Texturion/commit/2a175bbe705f12851d0cc828a4136af527e2c8b5))
* **quotes:** a crew can quote a job from an Android phone, not just a laptop ([c26e61b](https://github.com/BytechLabs/Texturion/commit/c26e61b8771d2a3618541264b7fd3f13c73956d6))
* **quotes:** a crew can quote a job from an iPhone too ([b2eda61](https://github.com/BytechLabs/Texturion/commit/b2eda615dacf163060769083da9ec811fca88dd3))
* **quotes:** take payment on an accepted quote without retyping the figure ([c4eaaf2](https://github.com/BytechLabs/Texturion/commit/c4eaaf253866f3599bb50bb8cf757b4b99760478))
* **quotes:** the money nobody has answered is a queue, not a number ([00087a5](https://github.com/BytechLabs/Texturion/commit/00087a5a41a31560c2725199a179c714362e3a94))
* **quotes:** the outstanding queue can chase, on all three clients ([db49b7f](https://github.com/BytechLabs/Texturion/commit/db49b7fefaf47dd763e78a1beca9ffe62754a6b9))
* **web:** a researcher can read what happens after they report a bug ([6a2028a](https://github.com/BytechLabs/Texturion/commit/6a2028ac835f142f201a358c12ee1bd4589a481b))
* **web:** set up your calendar from your profile settings ([7a57ef6](https://github.com/BytechLabs/Texturion/commit/7a57ef6d12cbcddedec52c0bc6b9e68fd1280f1d))


### Bug Fixes

* **api:** the two texts we send a customer about money speak their language ([7866bfe](https://github.com/BytechLabs/Texturion/commit/7866bfe36d638579b289841a4eae9cc8e31171ee))
* **contacts:** one control, one name for the workspace language option ([3372236](https://github.com/BytechLabs/Texturion/commit/3372236ffcbbd939b08aca6fec633bb75f759127))
* **dashboard:** the four measures share one heading on both phones ([f22f493](https://github.com/BytechLabs/Texturion/commit/f22f4939af11fe22f3a469427e32cd78bd179880))
* **quotes:** only the customer who opens the link can accept it ([305c445](https://github.com/BytechLabs/Texturion/commit/305c44590af4424bc22a4c6217ec6bd9028d1621))
* **quotes:** sending a quote now actually sends it ([966f8a2](https://github.com/BytechLabs/Texturion/commit/966f8a24be1e24511da550f2dc1830ebbdbee795))

## [0.16.0](https://github.com/BytechLabs/Texturion/compare/web-v0.15.2...web-v0.16.0) (2026-08-17)


### Features

* **clients:** a passkey works as a second factor on Android ([c3cbe2e](https://github.com/BytechLabs/Texturion/commit/c3cbe2eff44473f1f710308f1a0d579d3c6443bf))
* **clients:** let whoever does the books pull a period's usage from a phone ([#605](https://github.com/BytechLabs/Texturion/issues/605)) ([0d72460](https://github.com/BytechLabs/Texturion/commit/0d7246063f10be604783d29bef4eda50453e4bd4)), closes [#595](https://github.com/BytechLabs/Texturion/issues/595)
* **clients:** the Android app reads from a catalogue, and web finishes its own ([60e4289](https://github.com/BytechLabs/Texturion/commit/60e4289712cc2f4bcf1883e20f0295e08bd58ab6))
* **clients:** the deposit lands before anyone refreshes ([10aa248](https://github.com/BytechLabs/Texturion/commit/10aa248bab4fbcf06a850658a54498725989c6ee))
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
* **reports:** the website earns its own row, not the unknown pile ([14896cd](https://github.com/BytechLabs/Texturion/commit/14896cdda1cb07bed7ab88c5616b438924025f35))
* **shared:** what a quote's status means, decided once for three clients ([960d16d](https://github.com/BytechLabs/Texturion/commit/960d16d7a5f6bc0c306017345f0b63f7ee5a1a56))
* **web:** a crew can quote a job from the thread it was asked in ([94d04fb](https://github.com/BytechLabs/Texturion/commit/94d04fb34aecc9c4645712437e38477d9acd6c23))
* **web:** a homeowner can read a quote and accept it from a text ([3a24dc1](https://github.com/BytechLabs/Texturion/commit/3a24dc111cc3143e06a8496f34c971c63a7e7667))
* **web:** an owner can copy the Text-us snippet into their own website ([2078e79](https://github.com/BytechLabs/Texturion/commit/2078e79b1f0f552e6d3eb1b6210a3234add1c9ca))
* **web:** connect the workspace to its other apps ([71fb50a](https://github.com/BytechLabs/Texturion/commit/71fb50aa8bf00d4931de9d2115da4caf8768677e))
* **web:** create and switch off API keys ([9fce70d](https://github.com/BytechLabs/Texturion/commit/9fce70d6e7a1093316d29aa25a30f1081dbb38a0))
* **web:** one script tag puts a Text-us button on a customer's own website ([8b13eb5](https://github.com/BytechLabs/Texturion/commit/8b13eb5fd66003ac63b2799a7ab0df86c550c6f0))
* **web:** publish the accessibility conformance statement ([be95dad](https://github.com/BytechLabs/Texturion/commit/be95dadc8c81da3a49c3d716661732ccc8bc5a3f))
* **web:** publish the API reference, and pin the access rule on every route ([877e1c4](https://github.com/BytechLabs/Texturion/commit/877e1c436f72eec5e7a65095376d924cf0e6fd2b))
* **web:** see the Text us button before pasting it on your site ([7c4bb6c](https://github.com/BytechLabs/Texturion/commit/7c4bb6cbf37767ce9770b51bf6914116ceda9f57))
* **web:** stage a script-src that reports where it would have fired ([e985978](https://github.com/BytechLabs/Texturion/commit/e985978541477ac0ac9c9159be57e6a4c7745f8a))
* **web:** the TLS floor is 1.2, and the DPA is published ([8e9f9e9](https://github.com/BytechLabs/Texturion/commit/8e9f9e9a848f797a787235e0d3c9829db665e913))
* **web:** the website widget shows who powers it ([f9701ef](https://github.com/BytechLabs/Texturion/commit/f9701ef0296adb0f4b2c721a9cb65c13897c3814))
* **widget:** an 11pm visitor gets answered, and the owner picks the line ([5ed016e](https://github.com/BytechLabs/Texturion/commit/5ed016e12a2180f0303b56e56f0c97e7e6cffb19))


### Bug Fixes

* **api:** a prepaid year that ends early now pays the rest back ([cf221a0](https://github.com/BytechLabs/Texturion/commit/cf221a0d4355a654ac677eee1e8701824cb10aeb))
* **clients:** an exported name with an accent in it no longer arrives mangled ([dfefcfe](https://github.com/BytechLabs/Texturion/commit/dfefcfe9e3bb16f63b19fc9ee6331c0a970de94a)), closes [#587](https://github.com/BytechLabs/Texturion/issues/587)
* **clients:** both phones promised an add-on credit that never arrives ([b8ee805](https://github.com/BytechLabs/Texturion/commit/b8ee805a198e0bc922606d2558735b28e2b042be))
* **clients:** the quotes panel stops printing a rate it just called uncallable ([f9fd2e5](https://github.com/BytechLabs/Texturion/commit/f9fd2e54484f7a3b02e9f41e26c898b5ae65a8c7))
* **clients:** the sources card stays readable at 200% text ([ec84c89](https://github.com/BytechLabs/Texturion/commit/ec84c89944c5d4b49ec8a3a099635d43f1b5be4f))
* **deploy:** shut the second front door, in the repo rather than the dashboard ([f76a14b](https://github.com/BytechLabs/Texturion/commit/f76a14bcb3066d1a0e0990e0e5951a3e9f860309)), closes [#578](https://github.com/BytechLabs/Texturion/issues/578)
* **i18n:** a French reader ends a prepaid year in French ([db8e41a](https://github.com/BytechLabs/Texturion/commit/db8e41ab61e3d04dd91cc09727ce7b2240299166))
* **i18n:** the emergency-word screen warns in French, and now hears French ([f410dc4](https://github.com/BytechLabs/Texturion/commit/f410dc4cc79a22d1f985c08729f5a2b8a36f185a))
* **legal:** say that a workspace can send its own data somewhere ([a69f514](https://github.com/BytechLabs/Texturion/commit/a69f514a243ba17ddc21fc2893386c22a28ca7f1))
* **shared:** a French owner's referral message ends in French ([fcf037c](https://github.com/BytechLabs/Texturion/commit/fcf037c5e0ce86436406329ba869a86a969f2877))
* **shared:** the quotes card reads its own sentence in French on the web ([980b336](https://github.com/BytechLabs/Texturion/commit/980b33691a02139f22096c2224b2fe20bec64d3b))
* **web:** /security stops calling row-level security a second line of defence ([3303b9a](https://github.com/BytechLabs/Texturion/commit/3303b9a31d4b1ceee329c48db81be9f51babde9e))
* **web:** a refused attachment says why in French ([e2c3071](https://github.com/BytechLabs/Texturion/commit/e2c3071d6d5530d4ce49fc308c6e4662cee963da))
* **web:** a screen reader can read the command palette again ([5d04c0f](https://github.com/BytechLabs/Texturion/commit/5d04c0f709ad3b53f37ee6f64d3d00160b19aa3d))
* **web:** a second factor can be added once you already have one ([0f847eb](https://github.com/BytechLabs/Texturion/commit/0f847eb1cd3689d07d3e824002964793ec001dad))
* **web:** a URL cannot reach Sentry through a console breadcrumb ([30c7740](https://github.com/BytechLabs/Texturion/commit/30c7740aaff68a4c7f005ea76eb2d478381ae949))
* **web:** tables that scroll sideways can now be scrolled with a keyboard ([bc3998a](https://github.com/BytechLabs/Texturion/commit/bc3998a9f3a47e3ef609d74efe9820cc690fc9c6))
* **web:** the marketing changelog resolves its keys on the server ([8bf63bd](https://github.com/BytechLabs/Texturion/commit/8bf63bd23b4847313287f69ef0b91a6be14eaba4))
* **web:** the quote page speaks the workspace's language ([f4312ca](https://github.com/BytechLabs/Texturion/commit/f4312caaf26a8d54537370ebca1114b82e523150))
* **web:** the settings page loads again, and the snippet is readable ([42159b1](https://github.com/BytechLabs/Texturion/commit/42159b13da644a879dce4488e4d480561812b0f3))
* **web:** the spending-cap dialog asks in French too ([c37240f](https://github.com/BytechLabs/Texturion/commit/c37240fb20469c238422f0d48179dc91da0a6065))

## [0.15.2](https://github.com/BytechLabs/Texturion/compare/web-v0.15.1...web-v0.15.2) (2026-08-09)


### Bug Fixes

* **api:** the photos page a homeowner opens now behaves like every other download ([e38801c](https://github.com/BytechLabs/Texturion/commit/e38801ce5e1b32936209cb35a8b0ef2cfc58ef7f))
* **clients:** a contact shows the same initials everywhere in the product ([93df0c2](https://github.com/BytechLabs/Texturion/commit/93df0c2b4d436cd31f1e43426dcb5a95969b9d53))
* **clients:** confirming a handover asks for something, and takes the answer ([14978dd](https://github.com/BytechLabs/Texturion/commit/14978dd8d6ade91afff09ceba30dfe62253f5a78))

## [0.15.1](https://github.com/BytechLabs/Texturion/compare/web-v0.15.0...web-v0.15.1) (2026-08-09)


### Bug Fixes

* **billing:** stop a plan switch giving away a year somebody already paid for ([5c80385](https://github.com/BytechLabs/Texturion/commit/5c80385b0c48887e5265e0828190418f3b8da445))
* **clients:** a call row keeps its shape, and a transcript can be copied ([2ea3ccf](https://github.com/BytechLabs/Texturion/commit/2ea3ccf204a59380d99e98bdea420268cbdb1265)), closes [#566](https://github.com/BytechLabs/Texturion/issues/566)
* **clients:** a long call reads in hours instead of a growing minute count ([5937d04](https://github.com/BytechLabs/Texturion/commit/5937d04ec387305f725a030ee0f9ee135dd07aa3)), closes [#570](https://github.com/BytechLabs/Texturion/issues/570)
* **clients:** make signing out actually sign the device out ([8f04f99](https://github.com/BytechLabs/Texturion/commit/8f04f999e2d24969636ca556b1563b79969712b8))
* **clients:** repair what the last change broke, and finish what it claimed ([140a5c7](https://github.com/BytechLabs/Texturion/commit/140a5c7ca2de51e35ec4efdda1355cfa06f262c3)), closes [#566](https://github.com/BytechLabs/Texturion/issues/566)
* **clients:** the thread an urgent text opens now says it is urgent ([474aef6](https://github.com/BytechLabs/Texturion/commit/474aef6253820a1d06ea8da491efcf17b6b876a9)), closes [#565](https://github.com/BytechLabs/Texturion/issues/565)
* **web:** make the HTTPS pin outlive the cookie it protects ([7a9099f](https://github.com/BytechLabs/Texturion/commit/7a9099f49c1acc3255531c03100c71ca78ed03c5))
* **web:** one caller can no longer use up the whole status-page mailing list ([e56d827](https://github.com/BytechLabs/Texturion/commit/e56d8276a589ceabe87f1cec40753339c58aebdd)), closes [#575](https://github.com/BytechLabs/Texturion/issues/575)

## [0.15.0](https://github.com/BytechLabs/Texturion/compare/web-v0.14.0...web-v0.15.0) (2026-08-08)


### Features

* **settings:** choose whether we text a customer back about an emergency ([902a303](https://github.com/BytechLabs/Texturion/commit/902a303cb6923dd0e2a34913a3e367886d808f9b)), closes [#553](https://github.com/BytechLabs/Texturion/issues/553)


### Bug Fixes

* **inbox:** make every filter say what it is doing, and undo it ([5c5ad8f](https://github.com/BytechLabs/Texturion/commit/5c5ad8f711f09a88820256fcacbec5cb253775d3)), closes [#548](https://github.com/BytechLabs/Texturion/issues/548)
* **web,api:** stop sending a shared link's secret to our analytics vendor ([f53a434](https://github.com/BytechLabs/Texturion/commit/f53a434a21d7f5128a8b54b8cc099966c39fbfbf)), closes [#558](https://github.com/BytechLabs/Texturion/issues/558)
* **web:** a revoked photo link stops working immediately ([3003824](https://github.com/BytechLabs/Texturion/commit/3003824dd2433b5e7eac035ab947544437bd3077)), closes [#559](https://github.com/BytechLabs/Texturion/issues/559)

## [0.14.0](https://github.com/BytechLabs/Texturion/compare/web-v0.13.0...web-v0.14.0) (2026-08-08)


### Features

* ask new signups how they heard about us ([5f3fe9e](https://github.com/BytechLabs/Texturion/commit/5f3fe9ed4ea92da42b9ffbd2a5033fe61f94a9b9)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* recommend Loonext to another crew in one tap, from your phone ([8d44883](https://github.com/BytechLabs/Texturion/commit/8d4488316e231fa619d65ba06265449424db8414)), closes [#288](https://github.com/BytechLabs/Texturion/issues/288)
* send a customer the photos of their own job ([2d1907a](https://github.com/BytechLabs/Texturion/commit/2d1907afbc97787f7bf31f4ed4e3b6c69701207d)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* take the location out of photos before we store them ([d8c49c9](https://github.com/BytechLabs/Texturion/commit/d8c49c9e17a2d5592dd4ad2aa0a424047d8dd76b)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* **web:** draw an arrow on a photo before you send it ([144a0c2](https://github.com/BytechLabs/Texturion/commit/144a0c25c0d4cf60c542faf5f7ddd31b65961068)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)
* **web:** mark a note as the before or the after, and group a job by visit ([dd3cb94](https://github.com/BytechLabs/Texturion/commit/dd3cb94fe678558e01089bc4089ba748268445ed)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)


### Bug Fixes

* **clients:** keep the before-or-after choice when it is the last thing you tap ([4ce2bf0](https://github.com/BytechLabs/Texturion/commit/4ce2bf0b711e2a461de5295376950b3d13faa3e4)), closes [#294](https://github.com/BytechLabs/Texturion/issues/294)

## [0.13.0](https://github.com/BytechLabs/Texturion/compare/web-v0.12.0...web-v0.13.0) (2026-08-08)


### Features

* ask who you are before the doors that don't reopen ([d3ac642](https://github.com/BytechLabs/Texturion/commit/d3ac642ee535ed6c2a575dffa3fd86d0c65d2539)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **clients:** hand the truck phone over in one tap ([614ec2c](https://github.com/BytechLabs/Texturion/commit/614ec2cef808fd7b7afe44432bca287d521303c5)), closes [#330](https://github.com/BytechLabs/Texturion/issues/330)
* **web:** ask before you give up your own access ([f5c2baa](https://github.com/BytechLabs/Texturion/commit/f5c2baab681e55fdf1d741fdcef3bc43296c4cea)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)
* **web:** enter the code that confirms a handover ([6fab110](https://github.com/BytechLabs/Texturion/commit/6fab11054777425e8de047455c5b61d75a204f0d)), closes [#537](https://github.com/BytechLabs/Texturion/issues/537)
* **web:** warn before going quiet while you are on call ([fc5134c](https://github.com/BytechLabs/Texturion/commit/fc5134c424670ad15d002ae4d0a6eeed7722ae06)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)


### Bug Fixes

* **clients:** clear the phone when a session is ended for you ([b79639f](https://github.com/BytechLabs/Texturion/commit/b79639f3266234244fb8d5eb0b27a2da6858349d)), closes [#330](https://github.com/BytechLabs/Texturion/issues/330)
* **web:** move the access dialog out of the page file ([a0e2de4](https://github.com/BytechLabs/Texturion/commit/a0e2de4d03449f0dc87ef4187bf5c51216cc33dc)), closes [#538](https://github.com/BytechLabs/Texturion/issues/538)

## [0.12.0](https://github.com/BytechLabs/Texturion/compare/web-v0.11.1...web-v0.12.0) (2026-08-08)


### Features

* **clients:** draw every measure on the dashboard, on all three ([9c44463](https://github.com/BytechLabs/Texturion/commit/9c444635165262c90ceaf28336c6dfdefaee2029)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **clients:** let a member take a measure off their own screen ([58af901](https://github.com/BytechLabs/Texturion/commit/58af90141641f0456949013089c872c3d51a65dc)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **clients:** say why the customer's clock is the one that counts ([28134b2](https://github.com/BytechLabs/Texturion/commit/28134b2a521d4a3fc7d856057094e2e3fa8a9a2a)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **web:** choose which clock a scheduled time is in ([3562d68](https://github.com/BytechLabs/Texturion/commit/3562d68d6bd8b651c8d59f8a71ea8c1a2aafa3c9)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **web:** draw how many new customers actually got answered ([83c507b](https://github.com/BytechLabs/Texturion/commit/83c507be16a75737faa581c32a3cc95cb2a58cc4)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **web:** lay the landing screen out for the screen it is on ([006d2bd](https://github.com/BytechLabs/Texturion/commit/006d2bdad9b7925924fc3db407250d585687afa8)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **web:** put the most urgent thing first on the landing screen ([9f4d909](https://github.com/BytechLabs/Texturion/commit/9f4d90963cb033ceb79168335c350858c0c4703a)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **web:** sign in with a face or a fingerprint instead of typing a code ([04525dc](https://github.com/BytechLabs/Texturion/commit/04525dc4ccc7810369cb77309f6b387a70b628ee)), closes [#473](https://github.com/BytechLabs/Texturion/issues/473)


### Bug Fixes

* **clients:** name each switch after the card it turns off ([16d43d1](https://github.com/BytechLabs/Texturion/commit/16d43d111aeffa46a395258529c3155e1b07e83c)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **clients:** say whose clock a scheduled message is set to ([f9422a4](https://github.com/BytechLabs/Texturion/commit/f9422a44d6c382738cc908f7d37ad3ee1aa4a08a)), closes [#539](https://github.com/BytechLabs/Texturion/issues/539)
* **clients:** show transfer advice at the same point on every device ([ce00869](https://github.com/BytechLabs/Texturion/commit/ce00869f5b4489e106e81fef6599a57894866aa0))
* **web:** line the four measures up as one row ([5cd78cc](https://github.com/BytechLabs/Texturion/commit/5cd78cc2c21e9f7e2384ab730b482801dc5a5b42)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)
* **web:** order the landing sections to match the strip above them ([1bb4d2a](https://github.com/BytechLabs/Texturion/commit/1bb4d2a21e2ac7d85e73a72fe68ec24854ae7791)), closes [#540](https://github.com/BytechLabs/Texturion/issues/540)

## [0.11.1](https://github.com/BytechLabs/Texturion/compare/web-v0.11.0...web-v0.11.1) (2026-08-07)


### Bug Fixes

* **clients:** say how many values an import column did not show ([8a0f170](https://github.com/BytechLabs/Texturion/commit/8a0f1707c6070a58e187cb022f50d8f7f38f32de)), closes [#528](https://github.com/BytechLabs/Texturion/issues/528)

## [0.11.0](https://github.com/BytechLabs/Texturion/compare/web-v0.10.0...web-v0.11.0) (2026-08-07)


### Features

* a missed call on the sales line texts back in the sales line's words ([9766b5d](https://github.com/BytechLabs/Texturion/commit/9766b5ddd00448b8dd7cc1a942064310cbec2ace))
* **api,web:** choose what happens to a call after hours ([4a25b8e](https://github.com/BytechLabs/Texturion/commit/4a25b8ecda8d21dbb2fe03e97f892fc3591318c8))
* **api:** a bookkeeper can take a period's usage away as a file ([2e7713b](https://github.com/BytechLabs/Texturion/commit/2e7713baa396ff771bb6b8ea6db8bf6e516a7a85)), closes [#304](https://github.com/BytechLabs/Texturion/issues/304)
* **api:** an abuse report cannot be crowded out by ordinary traffic ([3112c3a](https://github.com/BytechLabs/Texturion/commit/3112c3abbdff1ba15f593739bb46a77e07eb2d55)), closes [#303](https://github.com/BytechLabs/Texturion/issues/303)
* **api:** the question goes out after a job, and a digit answers it ([056b62a](https://github.com/BytechLabs/Texturion/commit/056b62a4a5cc0b3eb6bcf3edfb95c2fc9ba461af))
* **api:** the work can be taken away as a file ([515a9d2](https://github.com/BytechLabs/Texturion/commit/515a9d2c92ccf09c7ffd6d2de7c3c1427806dabc)), closes [#304](https://github.com/BytechLabs/Texturion/issues/304)
* **api:** voicemail recordings age out on the year we publish for them ([a91079c](https://github.com/BytechLabs/Texturion/commit/a91079c975f7b5100b8be3ef41ebb2f60f73abb5)), closes [#284](https://github.com/BytechLabs/Texturion/issues/284)
* **clients:** a call line says who picked it up ([f5b2df4](https://github.com/BytechLabs/Texturion/commit/f5b2df49038845567a816832591a06ac31fd9fbd)), closes [#517](https://github.com/BytechLabs/Texturion/issues/517)
* **clients:** a crew can choose the language their automated texts go out in ([55c366d](https://github.com/BytechLabs/Texturion/commit/55c366d718fb92a80a7e61025062ace05d40ef30))
* **clients:** a joining orientation, and a notification ask with a reason ([d87bf03](https://github.com/BytechLabs/Texturion/commit/d87bf03635b7119bf56cf65bbd6e2b988a9f4da9)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** a member is told a number is hidden, not left to guess ([11d9ad4](https://github.com/BytechLabs/Texturion/commit/11d9ad4e252ac8bb9168e29d4711c8cee1f45549)), closes [#286](https://github.com/BytechLabs/Texturion/issues/286)
* **clients:** a new member can see who the crew is ([10ac78b](https://github.com/BytechLabs/Texturion/commit/10ac78bc31da49b9b5059e31b9e86bf6d1a59717))
* **clients:** a rejected transfer says what to fix instead of quoting the carrier ([10293ed](https://github.com/BytechLabs/Texturion/commit/10293ede2f697441b57bffd454a4780c756cad75)), closes [#319](https://github.com/BytechLabs/Texturion/issues/319)
* **clients:** answer the reason somebody gives for leaving ([0109464](https://github.com/BytechLabs/Texturion/commit/0109464f7e43d9bc333282bc9753ff932e90fdc1))
* **clients:** catch up on a thread without Lou inventing anything ([21e57c0](https://github.com/BytechLabs/Texturion/commit/21e57c0243bd5cc7945be62c3dd691ca1d162533))
* **clients:** choose how loud each kind of notification is ([444ff1f](https://github.com/BytechLabs/Texturion/commit/444ff1f41cde9b0ea3c6bd741afb9103e659182c))
* **clients:** choose how the phones ring, on all three ([7d20a6a](https://github.com/BytechLabs/Texturion/commit/7d20a6a53fea96a54014f5989359abb2ced0bf99)), closes [#278](https://github.com/BytechLabs/Texturion/issues/278)
* **clients:** have us call you, and record the greeting on the phone ([1520b32](https://github.com/BytechLabs/Texturion/commit/1520b32bf91640270477bbdc0b69c1ce2d5ae112)), closes [#309](https://github.com/BytechLabs/Texturion/issues/309)
* **clients:** how did you hear about us, as one tap ([56fe4fc](https://github.com/BytechLabs/Texturion/commit/56fe4fc6d2e194a458868cc45b2abe024bce7ab2)), closes [#301](https://github.com/BytechLabs/Texturion/issues/301)
* **clients:** keep the number your plan covers when you come back ([ef37c6d](https://github.com/BytechLabs/Texturion/commit/ef37c6d58565582d0015bbf4798a5161bda78efb))
* **clients:** one tap says "I have this", and the other phones stop ([2ef5b88](https://github.com/BytechLabs/Texturion/commit/2ef5b88b984cf37b9779bd4677a7fa86ac44013c))
* **clients:** pause a plan for the winter without losing the number ([b1444d7](https://github.com/BytechLabs/Texturion/commit/b1444d75c3725f79baf591ab1fa3a9e8e3734688))
* **clients:** put one person on call, and the rest get a quiet night ([af34999](https://github.com/BytechLabs/Texturion/commit/af34999d30b24c2d06a119ea2cd89f3cf6caf08a))
* **clients:** register US texting during a pause without being misled ([7f7017f](https://github.com/BytechLabs/Texturion/commit/7f7017f0bac2adde70107ed7c3fb5beee7e2a36f))
* **clients:** satisfaction sits beside response time, and refuses to guess ([94ae5ca](https://github.com/BytechLabs/Texturion/commit/94ae5ca3d0167d146bf88e67e400db1f38d411ff))
* **clients:** send later on both phones, and one place to see everything queued ([8987f1c](https://github.com/BytechLabs/Texturion/commit/8987f1cd7fa88dbe9b8efa6cb90692d80e867246))
* **clients:** send later reaches both phones, and the thread shows what is queued ([521d0f8](https://github.com/BytechLabs/Texturion/commit/521d0f860a74639af2e40efc3dc66fed1a4b0b3d))
* **clients:** set quiet hours without losing the night you are on call ([43c7b71](https://github.com/BytechLabs/Texturion/commit/43c7b71368ed0155f10b62c5da16a8e5b6594504))
* **clients:** set up the two reminders that stop a no-show ([d0076c7](https://github.com/BytechLabs/Texturion/commit/d0076c773f018dd1a119d33c31e1e826f88ce7d0))
* **clients:** somebody leaving can say why, and it costs them nothing ([8c234f7](https://github.com/BytechLabs/Texturion/commit/8c234f7d72ac6df0ffe7a183f6db22d1c1c82cd8))
* **clients:** switch reminders off for one job, and see who confirmed it ([1f782e3](https://github.com/BytechLabs/Texturion/commit/1f782e3464819b90408f4b9757a97812607a8027))
* **clients:** tell a customer mid-transfer what to do before their number switches ([0502558](https://github.com/BytechLabs/Texturion/commit/0502558fcb78d380298afe46b53a0727bb0f8c7d)), closes [#319](https://github.com/BytechLabs/Texturion/issues/319)
* **clients:** the contact record shows who a customer works for ([6844426](https://github.com/BytechLabs/Texturion/commit/68444265d28b08ec48bc5a81e8aad745ff47d115))
* **clients:** the note an owner writes reaches the person it was about ([2fc5b16](https://github.com/BytechLabs/Texturion/commit/2fc5b16725a458afec7a1aafd8ddbc286d86fada))
* **clients:** the phones can open the leads nobody answered ([bace185](https://github.com/BytechLabs/Texturion/commit/bace185b3444960ac3bcf877e41bf56c9d631ec5)), closes [#508](https://github.com/BytechLabs/Texturion/issues/508)
* **clients:** the thread says when a customer confirmed the appointment ([ccbdd9d](https://github.com/BytechLabs/Texturion/commit/ccbdd9dded3262f1a1ebb3e8b25126217a35635b))
* **clients:** the uploader makes the preview, on all three ([a243318](https://github.com/BytechLabs/Texturion/commit/a243318aa6926af2ce43c0f3754da5edb6e930a2)), closes [#240](https://github.com/BytechLabs/Texturion/issues/240)
* **clients:** the voicemail greeting is the owner's words, with nothing appended ([3dc8ce5](https://github.com/BytechLabs/Texturion/commit/3dc8ce572bd74de6f9f0154effb39ec3d05ccf57)), closes [#518](https://github.com/BytechLabs/Texturion/issues/518)
* **clients:** what you cannot reach, and why ([313837e](https://github.com/BytechLabs/Texturion/commit/313837e3c6ed335675096c564d787d0e0a75509e))
* **web:** a contact shows every address, with the main one named ([9675e8d](https://github.com/BytechLabs/Texturion/commit/9675e8d6c558a62634cfbba140e2ed5d9fa34665))
* **web:** a customer's other numbers sit on their record ([87cd111](https://github.com/BytechLabs/Texturion/commit/87cd11107d452179a536948b3fdf7de058c40d2e))
* **web:** a network drop explains itself instead of looking like a broken app ([1abd235](https://github.com/BytechLabs/Texturion/commit/1abd235dba37a2e1cdc056d7b71f20d836c884a0)), closes [#299](https://github.com/BytechLabs/Texturion/issues/299)
* **web:** a workspace defines its own contact fields, and the crew fills them in ([fc7847b](https://github.com/BytechLabs/Texturion/commit/fc7847bf9b1281f24b8eb9d90c0e0e69a64d4fe4))
* **web:** an owner can see and change how one line answers ([4f6a726](https://github.com/BytechLabs/Texturion/commit/4f6a726aa20c01b8b0a1f163a85e7d63ada15f81)), closes [#307](https://github.com/BytechLabs/Texturion/issues/307)
* **web:** choose which voice a line answers in ([9581d12](https://github.com/BytechLabs/Texturion/commit/9581d12f67c8aea5bd46c326659ed22ae132635b))
* **web:** every price surface quotes a Canadian visitor Canadian dollars ([0b499e9](https://github.com/BytechLabs/Texturion/commit/0b499e93b5203d965d74aa3b7f718c6c4150edd5))
* **web:** export one customer's messages from their record ([d8e9b8a](https://github.com/BytechLabs/Texturion/commit/d8e9b8a901bcc49aece0c50b8745cc44ae7116b0))
* **web:** pick a field and an answer to narrow the contacts list ([00503d7](https://github.com/BytechLabs/Texturion/commit/00503d79554bf680069fd8ead46950b0cb59bb6d))
* **web:** record the greeting in your own voice ([238d665](https://github.com/BytechLabs/Texturion/commit/238d665cd260a3dc67c108e0f1de146b7a1a0655))
* **web:** say when we would tell you about a breach, and what we do not hold ([08ea5b9](https://github.com/BytechLabs/Texturion/commit/08ea5b9d09809edaba876cc4285fd076c59a9bed)), closes [#285](https://github.com/BytechLabs/Texturion/issues/285)
* **web:** schedule a text from the composer instead of remembering to send it ([60be513](https://github.com/BytechLabs/Texturion/commit/60be513d4a2fec7aa7caf0495e4f02be2ed89045))
* **web:** send an on-my-way text with an ETA, one tap from the thread ([5d0ce47](https://github.com/BytechLabs/Texturion/commit/5d0ce472fcb57422c9e7df64232cd90fae119c23))
* **web:** three controls a screen reader user could not reliably hit ([ff0323b](https://github.com/BytechLabs/Texturion/commit/ff0323ba74a8faa7e8180dcddcf6d3da5b826b7c)), closes [#238](https://github.com/BytechLabs/Texturion/issues/238)
* **web:** when this line is open, beside how it answers ([8d40191](https://github.com/BytechLabs/Texturion/commit/8d401916a117ff567fcd82f78dfff37e609c0398))
* **web:** where your customers come from ([6de33ae](https://github.com/BytechLabs/Texturion/commit/6de33ae26ab978798ff563594199353f67456799))


### Bug Fixes

* an Equatable Swift struct cannot store a property wrapper ([dd38f77](https://github.com/BytechLabs/Texturion/commit/dd38f7718a8d2c54edf6262acbaacb6aebc1929f))
* **api:** a reply to a Loonext email reaches a person, on every deploy ([bfe715e](https://github.com/BytechLabs/Texturion/commit/bfe715e9c355a2fe09f45e2311206d6a2a188b40)), closes [#252](https://github.com/BytechLabs/Texturion/issues/252)
* **calls:** the in-call Messages and Transfer buttons stop disappearing ([12091fc](https://github.com/BytechLabs/Texturion/commit/12091fc09f9b22119ded5165877ccd5c5f3f1c5b)), closes [#516](https://github.com/BytechLabs/Texturion/issues/516)
* **clients:** a Canadian workspace can buy an extra number again ([9b058f5](https://github.com/BytechLabs/Texturion/commit/9b058f5f96db82bee4eef17b0cd8c2672f8c4b49)), closes [#522](https://github.com/BytechLabs/Texturion/issues/522)
* **clients:** a role only reaches the settings its capabilities allow ([23ee9d1](https://github.com/BytechLabs/Texturion/commit/23ee9d1c617eb77cc9dedc7ffd7aa043660ccc09)), closes [#515](https://github.com/BytechLabs/Texturion/issues/515)
* **clients:** quote the currency the customer is actually charged in ([575f868](https://github.com/BytechLabs/Texturion/commit/575f8682db04eb5b7eccf8612834193fb69e2dad))
* **clients:** three automated texts stop costing double to deliver ([953b02c](https://github.com/BytechLabs/Texturion/commit/953b02c5a190dd66b9080b8fe00b4d13a0f977a7))
* **clients:** your usage screen quotes your own currency, not US dollars ([bb79892](https://github.com/BytechLabs/Texturion/commit/bb7989235a61c569e8c6065b8897ecc1496748c4)), closes [#522](https://github.com/BytechLabs/Texturion/issues/522)
* the iOS build stops breaking on a private helper the module already has ([e91e4f8](https://github.com/BytechLabs/Texturion/commit/e91e4f82b4b4cd4e70f9e51042c4bbe191746596))
* **web:** a blip no longer blanks the inbox and the thread you were reading ([395bf43](https://github.com/BytechLabs/Texturion/commit/395bf438bea5c94b2aab043c1c303e6523476686)), closes [#299](https://github.com/BytechLabs/Texturion/issues/299)
* **web:** a focus ring you can see, on every control ([064690a](https://github.com/BytechLabs/Texturion/commit/064690a2c29510fcbc02acbf05239cbfc98b4e9f))
* **web:** a half-typed reply survives closing the tab or switching threads ([d1dadb3](https://github.com/BytechLabs/Texturion/commit/d1dadb3e83c668c4e827b5c56bb7ffb28947d28a)), closes [#299](https://github.com/BytechLabs/Texturion/issues/299)
* **web:** a reply that failed to send says so, and retrying it cannot bill twice ([f0b3dca](https://github.com/BytechLabs/Texturion/commit/f0b3dcaf64a13b6d447e5853b847a5fb5d0225d1)), closes [#299](https://github.com/BytechLabs/Texturion/issues/299)
* **web:** drain the retry chain more than once before asserting on it ([d94ae3e](https://github.com/BytechLabs/Texturion/commit/d94ae3e18e939223a5c46f4ccf6e8b49fbf48eed))
* **web:** drop the zero-width space that failed lint ([71eb098](https://github.com/BytechLabs/Texturion/commit/71eb0982f8a323002dcfdc43b058dff8551cf690))
* **web:** searching for a number by digits actually searches for it ([0cf1d20](https://github.com/BytechLabs/Texturion/commit/0cf1d20f1a590cfe2210958e88624452f1cd2694)), closes [#513](https://github.com/BytechLabs/Texturion/issues/513)
* **web:** stop showing two prices for one registration fee ([3befaf6](https://github.com/BytechLabs/Texturion/commit/3befaf618af37fcb9206a0542662c4e5a9a1d91f))
* **web:** the calendar can be rescheduled without dragging ([cf7a05d](https://github.com/BytechLabs/Texturion/commit/cf7a05de0fce63b8c6cdf8970ce851e2a01f4d86)), closes [#238](https://github.com/BytechLabs/Texturion/issues/238)

## [0.10.0](https://github.com/BytechLabs/Texturion/compare/web-v0.9.0...web-v0.10.0) (2026-08-02)


### Features

* **api:** a thread marked as spam stops spending the AI budget ([f53b9bd](https://github.com/BytechLabs/Texturion/commit/f53b9bd65778b06296028dca49f47e68a30eff61)), closes [#250](https://github.com/BytechLabs/Texturion/issues/250)
* **app:** the banner that says what broke can now tell us about it ([221f1b9](https://github.com/BytechLabs/Texturion/commit/221f1b909ae900aa6b1260d48c74f7f4353be304))
* **app:** we say we will write back when a fix ships, and now we do ([7917b38](https://github.com/BytechLabs/Texturion/commit/7917b3823131e1d33f6dcb5e43a42fc819bf68b4))
* **billing:** the billing page offers a year, and the alert stops counting it ([702f34a](https://github.com/BytechLabs/Texturion/commit/702f34a03ab11d6d99f50694d2a55fa1f8f9384b))
* **clients:** a repeat customer is visible without opening the contact panel ([c3def7f](https://github.com/BytechLabs/Texturion/commit/c3def7f69ea259380709c1c876a33a451a651601)), closes [#505](https://github.com/BytechLabs/Texturion/issues/505)
* **clients:** a tech can see a repeat customer without reading a list ([77f659d](https://github.com/BytechLabs/Texturion/commit/77f659d0411405d33b7e8397fc59cf7ea9e48202)), closes [#410](https://github.com/BytechLabs/Texturion/issues/410)
* **clients:** a thread that looks like spam says so, instead of going quiet ([bd5b003](https://github.com/BytechLabs/Texturion/commit/bd5b0033673097df1da1dfc64d09a1a1a0158f29)), closes [#250](https://github.com/BytechLabs/Texturion/issues/250)
* **clients:** say what a call was about and Lou writes it into a note ([18cb2fa](https://github.com/BytechLabs/Texturion/commit/18cb2fab55e96820b43dd7e8a493f50cc3efbca8)), closes [#507](https://github.com/BytechLabs/Texturion/issues/507)
* **compose:** the composer preview stops hiding what it cannot know ([f50e31b](https://github.com/BytechLabs/Texturion/commit/f50e31b1ca636648a14547e4ee9cae5a7153ed39))
* **inbox:** a saved reply now records that it was the one sent ([452bcd4](https://github.com/BytechLabs/Texturion/commit/452bcd4e6b907c810040ebdf1c0199a0775c7a62))
* **inbox:** a tag can say what it means, and there is a limit on how many ([6b9b85c](https://github.com/BytechLabs/Texturion/commit/6b9b85ce19d06beaf4a25228a6e557ab90b59070))
* **inbox:** saved views appear as a row you can tap ([179c57f](https://github.com/BytechLabs/Texturion/commit/179c57f6dc08b39598a068778f322af0cc179091))
* **inbox:** the phones can tidy tags too, and a crew can freeze the list ([1ebf918](https://github.com/BytechLabs/Texturion/commit/1ebf918a3b8ede21a6693718e43feca5e5c66ff3))
* **marketing:** a page says what shipped, so improvement stops being invisible ([8ba5aae](https://github.com/BytechLabs/Texturion/commit/8ba5aae29f83cdbcf1ce6bf5ccece9f4237dfc4a))
* **marketing:** campaign parameters survive scrubbing, and nothing else does ([7227403](https://github.com/BytechLabs/Texturion/commit/7227403d0c32e93623da4f0ec86f7f76e1a6f393)), closes [#296](https://github.com/BytechLabs/Texturion/issues/296)
* **marketing:** the comparison pages argue capability, not only price ([d26e4dd](https://github.com/BytechLabs/Texturion/commit/d26e4dd413c775462c03e746cc422bc4037a7bb8)), closes [#435](https://github.com/BytechLabs/Texturion/issues/435)
* **marketing:** the page a customer arrived through reaches their workspace ([8097fc0](https://github.com/BytechLabs/Texturion/commit/8097fc00c9920ddb08ecb2298bf706fcf695c0ce)), closes [#296](https://github.com/BytechLabs/Texturion/issues/296)
* **referrals:** the referrer can see their link and what it did ([932c090](https://github.com/BytechLabs/Texturion/commit/932c0907def800092d568dd61f0f6de7f6d014b4))
* **settings:** the template editor offers all seven variables, and shows them working ([a3b5f6f](https://github.com/BytechLabs/Texturion/commit/a3b5f6fcf1aa9d41101ad95dab6ec46cbacd9404))
* **signup:** the signup asks how big the crew is ([620a12f](https://github.com/BytechLabs/Texturion/commit/620a12fc0011528af1ca90005b0a73af64ea21b1))
* **web:** a dot shows when something new shipped, and never interrupts ([03f1d04](https://github.com/BytechLabs/Texturion/commit/03f1d043cdfef756225ebcd7e1cc6706b8a73c0e))
* **web:** templates group by category, and the picker opens on what you use ([8c08b40](https://github.com/BytechLabs/Texturion/commit/8c08b40164ff4e70494be3cd1c03c35e199a51ce))
* **web:** the contacts page shows the duplicates it found ([c235572](https://github.com/BytechLabs/Texturion/commit/c23557289ef2d595afab38865fce398d221b68fc))
* **web:** the home screen shows how many quotes turned into work ([7ef2789](https://github.com/BytechLabs/Texturion/commit/7ef27893ba1eb18333ff9e238c9305a4416d4c69))
* **web:** the tag list shows what gets used, and duplicates can be merged ([90add66](https://github.com/BytechLabs/Texturion/commit/90add664218b93b463a3702b35c9e71384315322))


### Bug Fixes

* **compare:** the Heymarket chart was drawing Quo's seat price ([dd3dc04](https://github.com/BytechLabs/Texturion/commit/dd3dc04ce851618b581e0a8e8503accfd63f691f))
* **ios:** the pipeline models build with a zero-argument init ([24d0bba](https://github.com/BytechLabs/Texturion/commit/24d0bbaec5e6343436852cbcd3cd3fd97422a992))
* **marketing:** the pricing FAQ no longer sells a voice add-on that was retired ([5b68e25](https://github.com/BytechLabs/Texturion/commit/5b68e258fa51271302b992b944803012da701737))
* **referrals:** a referral link now credits the person who sent it ([549d290](https://github.com/BytechLabs/Texturion/commit/549d290d58a2926e50e536ea2d729233c0c0bb2c))
* **web:** a read-only observer is no longer shown a checklist they cannot act on ([0398066](https://github.com/BytechLabs/Texturion/commit/03980664fb9ea969b784b35d25ef5aab19171a3d)), closes [#504](https://github.com/BytechLabs/Texturion/issues/504)
* **web:** the scrubber stops importing shared, which broke the build ([1dba7d7](https://github.com/BytechLabs/Texturion/commit/1dba7d703e2665eebcd89efe2e502ebf08907587))

## [0.9.0](https://github.com/BytechLabs/Texturion/compare/web-v0.8.0...web-v0.9.0) (2026-08-01)


### Features

* **billing:** tell the owner how many customers rang while their number was off ([29ee30f](https://github.com/BytechLabs/Texturion/commit/29ee30f5394a91f75001840e10c4532a4ee2fe41))
* **clients:** add a view-only role for people who should see the work, not change it ([fc87232](https://github.com/BytechLabs/Texturion/commit/fc87232b2a780da17005b7139378ed5e7fec6bc7)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **clients:** only an owner or admin can change the crew's saved replies ([733b877](https://github.com/BytechLabs/Texturion/commit/733b87702ff1aa950f47190fce0646378ff306c3)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315) [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **clients:** settings lists what is yours, not what you cannot touch ([ccc91bb](https://github.com/BytechLabs/Texturion/commit/ccc91bb2ad71cd6de9f4f5004e47bcc7cc8db12a)), closes [#461](https://github.com/BytechLabs/Texturion/issues/461)
* **dialer:** the keypad finds people by name, and can text them ([cdc149b](https://github.com/BytechLabs/Texturion/commit/cdc149b98f937682110075709b17355b3b9b31e1))
* **mobile:** bulk task actions reach Android and iOS ([8e81829](https://github.com/BytechLabs/Texturion/commit/8e8182966c4257e670c0497783e729e9acb3127c))
* **reports:** the per-number response times finally have a reader ([4265c6e](https://github.com/BytechLabs/Texturion/commit/4265c6ee67d6530e564b31abaf9a591ed6493307))
* **settings:** a departing owner writes what their customers will hear ([5849489](https://github.com/BytechLabs/Texturion/commit/5849489d87eecce630f9f1c3232a016877124463))
* **web:** add a bookkeeper role that gets billing without the inbox ([27f133e](https://github.com/BytechLabs/Texturion/commit/27f133e1c6b67d7554426a895cfcadfc42b60eaa)), closes [#315](https://github.com/BytechLabs/Texturion/issues/315)
* **web:** customers can ask to be emailed when something breaks ([14c4489](https://github.com/BytechLabs/Texturion/commit/14c4489966de4cffd05ba9c00969e2a427374912))
* **web:** repaint the app and marketing neutral, with lime as the one accent ([20858a5](https://github.com/BytechLabs/Texturion/commit/20858a59d3e3495015a5d4658013268191df421d))
* **web:** tick off, hand over or clear a whole task list at once ([a205ca9](https://github.com/BytechLabs/Texturion/commit/a205ca970642c925c816c34e41e0f165ae36fbcf))


### Bug Fixes

* **auth:** a second factor you turned on is now actually required ([f0f4946](https://github.com/BytechLabs/Texturion/commit/f0f49469a6f220b1b50ede39cd330c2bd012d3e4))

## [0.8.0](https://github.com/BytechLabs/Texturion/compare/web-v0.7.0...web-v0.8.0) (2026-07-31)


### Features

* a carrier that revokes US texting no longer reads as approved ([ab81bad](https://github.com/BytechLabs/Texturion/commit/ab81bad6196125400feb02905420e3a413166afe)), closes [#423](https://github.com/BytechLabs/Texturion/issues/423)
* a failed text says why in plain terms, not a carrier's error number ([5e59ec0](https://github.com/BytechLabs/Texturion/commit/5e59ec0501143794d6179002a96e6b1903c3bebd)), closes [#241](https://github.com/BytechLabs/Texturion/issues/241)
* a switch that does not need a deploy, and a runbook for 2am ([52bae11](https://github.com/BytechLabs/Texturion/commit/52bae1104560bbe857221c9646f69c5976517e31)), closes [#283](https://github.com/BytechLabs/Texturion/issues/283)
* **api:** contact-form data from non-customers now ages out ([d4ff05b](https://github.com/BytechLabs/Texturion/commit/d4ff05bf82bf2e28d6ba04f1825f98f9b69dfe13)), closes [#340](https://github.com/BytechLabs/Texturion/issues/340)
* **api:** let an owner sign first messages with the business name ([c9da4b5](https://github.com/BytechLabs/Texturion/commit/c9da4b5780492e4e921638b85f506fb26e34d421)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **api:** no automated text reaches a Texas number before noon on a Sunday ([3562bcb](https://github.com/BytechLabs/Texturion/commit/3562bcb4a98fedc4af177561ed17223c130a015d))
* **attachments:** look inside the files we hand between strangers ([08fb569](https://github.com/BytechLabs/Texturion/commit/08fb5697b6aa9ae53a77b662d1da21103bfb5eb8)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **calls:** give a call an address ([3a6b9ac](https://github.com/BytechLabs/Texturion/commit/3a6b9ac0f96ab115b3d5d0de46986490e6dd23fb))
* **calls:** the voicemail asks what the job is, and writes the answer down ([a6e3c26](https://github.com/BytechLabs/Texturion/commit/a6e3c26b0a4c8e1d53adbe36b5a73bf0f6e47961))
* **ci:** scan for secrets and vulnerable dependencies on a public repo ([3855270](https://github.com/BytechLabs/Texturion/commit/3855270d8f93e68caade2769523446d5363bb59b))
* **clients:** a crew member can see and fix their bouncing email address ([6f4b066](https://github.com/BytechLabs/Texturion/commit/6f4b066e082a0e57bf53ffbf55177dd8766c292a))
* **clients:** a toggle stops looking like an action ([e7a1c10](https://github.com/BytechLabs/Texturion/commit/e7a1c10dc1517a228f32d14b13e824bc4fc1a68a)), closes [#465](https://github.com/BytechLabs/Texturion/issues/465)
* **clients:** ask before sending on top of a colleague's answer ([eeb3a1c](https://github.com/BytechLabs/Texturion/commit/eeb3a1c983a49c34394b4564c4fa1d0e47306298))
* **clients:** choose the words your customers text in an emergency ([f9a9b69](https://github.com/BytechLabs/Texturion/commit/f9a9b696128ea5076a6da1535379061ea180583f)), closes [#460](https://github.com/BytechLabs/Texturion/issues/460)
* **clients:** clearing the bell on your phone clears it on your laptop ([473ae80](https://github.com/BytechLabs/Texturion/commit/473ae80673c845d990a51705e39702931000e729))
* **clients:** let an owner sign first texts, and count the signature ([176da2f](https://github.com/BytechLabs/Texturion/commit/176da2f4b1e9e244733da6424efad210ab5b27f2)), closes [#393](https://github.com/BytechLabs/Texturion/issues/393)
* **clients:** one long-press pulls a bad file away from the whole crew ([8674117](https://github.com/BytechLabs/Texturion/commit/86741171626c021ab4841fca886fce29b3defd01)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **clients:** realtime follows the numbers you can actually reach ([30bb1cc](https://github.com/BytechLabs/Texturion/commit/30bb1cc19ca831da48c16fa2cffc1552e4397bc5)), closes [#480](https://github.com/BytechLabs/Texturion/issues/480)
* **clients:** say when the crew is bigger than one call can ring ([65a062e](https://github.com/BytechLabs/Texturion/commit/65a062e34800587fbab8f91779e532fd31564ca5))
* **clients:** say why you deferred it, not just until when ([df2b159](https://github.com/BytechLabs/Texturion/commit/df2b159e782edbe4bcc134fcdf8c0cf30b24256a)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **clients:** see which numbers a teammate reaches, and why ([e646669](https://github.com/BytechLabs/Texturion/commit/e646669b06ecb2398d39e0d1831fb58720e5d436))
* **clients:** tell a crew member why they cannot text from this number ([8def71f](https://github.com/BytechLabs/Texturion/commit/8def71fac8b5ac7136a59cd0c4df1f96f8502982))
* **clients:** the response-time panel lands on all three clients ([aa9f7a9](https://github.com/BytechLabs/Texturion/commit/aa9f7a9308f58e37ea0876976187ba57442df87a)), closes [#239](https://github.com/BytechLabs/Texturion/issues/239)
* **clients:** timeline lines that name a task or a message now go there ([ce06451](https://github.com/BytechLabs/Texturion/commit/ce064513b7761bfd92da0f53cd9e4245eee6133e)), closes [#465](https://github.com/BytechLabs/Texturion/issues/465)
* **compliance:** tell customers about the carrier's own daily ceiling ([c30f36c](https://github.com/BytechLabs/Texturion/commit/c30f36c1e7648cf6004344b04432d4d1f894b735))
* **contacts:** one history for a customer, instead of six threads to open ([37d0ab1](https://github.com/BytechLabs/Texturion/commit/37d0ab1e907b08ea300586e99e06e8619d8c1122)), closes [#324](https://github.com/BytechLabs/Texturion/issues/324)
* **docs:** the two documents describing our third parties can no longer diverge ([ac28591](https://github.com/BytechLabs/Texturion/commit/ac28591eb75ba878786d9e8e3130a6093e9921be)), closes [#438](https://github.com/BytechLabs/Texturion/issues/438)
* **focus:** remind me to chase this, if they haven't replied ([fd7a14d](https://github.com/BytechLabs/Texturion/commit/fd7a14d5b3356d088c97c2ee4eef3ff8a6bec94d)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **inbox:** give the crew a first screen written for them ([c885251](https://github.com/BytechLabs/Texturion/commit/c8852516251b303ac4c793ab5282100cdb7dbb61))
* **ios:** see every device signed in to your account, and end one ([fb26823](https://github.com/BytechLabs/Texturion/commit/fb26823f7066b660e18536aac6ce678957024a79))
* **marketing:** six trade pages stop calling us a text inbox ([50d0151](https://github.com/BytechLabs/Texturion/commit/50d015104197e99f51d949d4c24a159a7bdb2709)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** tasks and contacts get the pages their app tabs deserve ([bb10172](https://github.com/BytechLabs/Texturion/commit/bb10172779eb9a2325e95c71a11fb58be272fcb0)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the assistant gets a page, and llms.txt admits one feature ships off ([a04c198](https://github.com/BytechLabs/Texturion/commit/a04c1985325c1f2bf720fdbdcf3f5b54b8133f60)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the Canada row competitors cannot fill, on a date that cannot rot ([04f727d](https://github.com/BytechLabs/Texturion/commit/04f727d210f5c0ab5e2a23bde30475a4b6b5d01f)), closes [#403](https://github.com/BytechLabs/Texturion/issues/403) [#369](https://github.com/BytechLabs/Texturion/issues/369)
* **marketing:** the demos finally place a call ([db1fa3f](https://github.com/BytechLabs/Texturion/commit/db1fa3fbb94b85732ec7c28723fd4d4b0dd102e0)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the home FAQ finally answers whether we do phone calls ([f90034e](https://github.com/BytechLabs/Texturion/commit/f90034e12bd09b8187a9cfc54ea8c456c1c968a5)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the site stops being blinding for anyone whose phone is dark ([61a6156](https://github.com/BytechLabs/Texturion/commit/61a6156cb3befbd8510f33bdb9403785fdeadbcb)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* notice a number has gone bad before the customer does ([f03fb4a](https://github.com/BytechLabs/Texturion/commit/f03fb4a71d2c985bb736f3f38e2c5ce2138543a0)), closes [#235](https://github.com/BytechLabs/Texturion/issues/235)
* **notifications:** let a business keep customers' words off lock screens ([91242b3](https://github.com/BytechLabs/Texturion/commit/91242b36b1d6d50415ec6142847c613af5af85a3))
* **ops:** support fixes get a dry run and a record, instead of psql ([0149d2d](https://github.com/BytechLabs/Texturion/commit/0149d2d403d5b7dfb1774790a8782bacce143319))
* **pricing:** tell a switcher what leaving looks like, before they join ([7a02ee3](https://github.com/BytechLabs/Texturion/commit/7a02ee3649a5623ca63bf0c79ec0e85987dc3560)), closes [#425](https://github.com/BytechLabs/Texturion/issues/425)
* **registration:** say why the carrier said no, and which box to fix ([78c7756](https://github.com/BytechLabs/Texturion/commit/78c7756bc8b46c498e17487fdd3a16d0c7cb84ea)), closes [#352](https://github.com/BytechLabs/Texturion/issues/352)
* **reports:** measure the first response we sell, and show the arc ([e337a89](https://github.com/BytechLabs/Texturion/commit/e337a89a7571501e36221c176ace56824bc63631)), closes [#239](https://github.com/BytechLabs/Texturion/issues/239)
* **search:** find a voicemail by what was said in it ([6f9b682](https://github.com/BytechLabs/Texturion/commit/6f9b682db4d9afa8a468052ff8d27d5d6573a9eb))
* **settings:** the night trade can stop us asking, without us stopping the rule ([fbed55f](https://github.com/BytechLabs/Texturion/commit/fbed55f1d5193b8f12a04a65d58b9cad89babbb3)), closes [#225](https://github.com/BytechLabs/Texturion/issues/225)
* **status:** publish an outage caused by the deploy pipeline itself ([2ed19f4](https://github.com/BytechLabs/Texturion/commit/2ed19f474b5baab1b391629cdcf3d8b8de5b57a6)), closes [#242](https://github.com/BytechLabs/Texturion/issues/242)
* **templates:** a saved reply can be recovered, and every change has a name ([3774cf9](https://github.com/BytechLabs/Texturion/commit/3774cf954216a56444646ee5eba3933f1fe4796b))
* the server learns what everyone is running, and can ask them to move ([c10bd41](https://github.com/BytechLabs/Texturion/commit/c10bd41e21063d21645ccee02332e1489f051059)), closes [#339](https://github.com/BytechLabs/Texturion/issues/339)
* the SIN is asked for after payment, not before ([4dc1811](https://github.com/BytechLabs/Texturion/commit/4dc1811d364f782cfbe7723b04c4252c8be677f7)), closes [#458](https://github.com/BytechLabs/Texturion/issues/458) [#381](https://github.com/BytechLabs/Texturion/issues/381)
* the wait for texting approval shows progress and what to do meanwhile ([a927841](https://github.com/BytechLabs/Texturion/commit/a927841d510098a2d389cea607b13e76ca054db7)), closes [#310](https://github.com/BytechLabs/Texturion/issues/310)
* **theming:** measure what the browser painted, not what the tokens promised ([af08470](https://github.com/BytechLabs/Texturion/commit/af084703148ee19eabd2606832d0f14b2f506172)), closes [#320](https://github.com/BytechLabs/Texturion/issues/320)
* **web:** a screen that says what is signed in, and a button that ends it ([23801bb](https://github.com/BytechLabs/Texturion/commit/23801bb98a4e7803eeae902bc135cc043c9e11eb))
* **web:** add the olive tokens before anything reads them ([37e4901](https://github.com/BytechLabs/Texturion/commit/37e49012be4ed733a2f02285465d40135086c733)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** ask us to email you the comparison, and unsubscribe in one click ([d57f125](https://github.com/BytechLabs/Texturion/commit/d57f125a32069d462d40c7e81743be65b607197c)), closes [#312](https://github.com/BytechLabs/Texturion/issues/312)
* **web:** clear a week of threads without opening every one ([3112911](https://github.com/BytechLabs/Texturion/commit/3112911242820405da5ffba574e2a4d68795c051))
* **web:** count the visitor who asks instead of buying ([c1faba4](https://github.com/BytechLabs/Texturion/commit/c1faba4ff017d17ecf369f85f544728db23663c3)), closes [#312](https://github.com/BytechLabs/Texturion/issues/312)
* **web:** defer a thread, and a way back to everything you deferred ([590912e](https://github.com/BytechLabs/Texturion/commit/590912ea207c6b77b0b4dc9349f901ad78b89836)), closes [#293](https://github.com/BytechLabs/Texturion/issues/293)
* **web:** hand the workspace over, and name who takes it if you cannot ([1e2ac1f](https://github.com/BytechLabs/Texturion/commit/1e2ac1f66cf5fde9f26c27655ec58e7e8a7d7394))
* **web:** publish what deletion reaches, and what it does not ([e4772d8](https://github.com/BytechLabs/Texturion/commit/e4772d8b3f1451e9caecfcf31f568fcb8b680a50))
* **web:** publishing a guide now updates the file that describes us to machines ([cd8ce5a](https://github.com/BytechLabs/Texturion/commit/cd8ce5ae75c4897e5882a07d40fca62c0a388922)), closes [#451](https://github.com/BytechLabs/Texturion/issues/451)
* **web:** repaint the product olive, in one commit and with no call-site edits ([92a73ca](https://github.com/BytechLabs/Texturion/commit/92a73cae6e65242e0d8547ca0f6b15a81b7e2008)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** signing up now looks like the product you are signing up for ([64b5508](https://github.com/BytechLabs/Texturion/commit/64b550869ad9f785b0e6aa8c966118d74260c71a)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** tell customers you are shut for the holiday ([8aba768](https://github.com/BytechLabs/Texturion/commit/8aba7687ae9439c269ec7b25c07fdc4452c865c3))
* **web:** the composer says what time it is where the customer is ([98ce03e](https://github.com/BytechLabs/Texturion/commit/98ce03e0607b84a32af7486f6b3d6b45fd7e7139))
* **web:** the marketing site and the product finally look like one company ([05c64fe](https://github.com/BytechLabs/Texturion/commit/05c64fe98c92c0bc706355d2898c9f8cd47868ec)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** the plan step says the price as a daily amount too ([1c23b8f](https://github.com/BytechLabs/Texturion/commit/1c23b8fb0152cf870f644e2a4dea2d8a5f8cb3f3)), closes [#381](https://github.com/BytechLabs/Texturion/issues/381)
* **web:** the thread says when a teammate is already on it ([d0e0be1](https://github.com/BytechLabs/Texturion/commit/d0e0be1390066bae9554e6dd822acda80cd9c784)), closes [#302](https://github.com/BytechLabs/Texturion/issues/302)
* **web:** turn on two-factor, and don't lose the spare key ([9f2fa09](https://github.com/BytechLabs/Texturion/commit/9f2fa09ec977e0347687a13f3cc31218d336ad9b))


### Bug Fixes

* **api:** a fresh import no longer queues behind every other workspace ([f8738aa](https://github.com/BytechLabs/Texturion/commit/f8738aa64c49c488c60313f6278cc7b94efe68ba)), closes [#440](https://github.com/BytechLabs/Texturion/issues/440)
* **api:** see whether Lou's drafts get sent, not just what they cost ([53388aa](https://github.com/BytechLabs/Texturion/commit/53388aad4f4509889f320e07867e838f51e4e6f1)), closes [#431](https://github.com/BytechLabs/Texturion/issues/431)
* **attachments:** the allow-list matches the bucket, and a failed upload cleans up ([477f2dc](https://github.com/BytechLabs/Texturion/commit/477f2dc9be318705fed4db16ff4f958cf4d19a07)), closes [#262](https://github.com/BytechLabs/Texturion/issues/262)
* **clients:** a Canadian workspace can buy an extra number ([1ca1fde](https://github.com/BytechLabs/Texturion/commit/1ca1fde9a3adf83bd6a5761d2ab5d726b1985a6c)), closes [#464](https://github.com/BytechLabs/Texturion/issues/464)
* **clients:** a mis-swipe on a phone is recoverable, and a file needs asking ([d477d3c](https://github.com/BytechLabs/Texturion/commit/d477d3cda1940fd277e91cddf7585d6190257107)), closes [#295](https://github.com/BytechLabs/Texturion/issues/295)
* **clients:** a note-only member is told calls will not ring them ([aff6673](https://github.com/BytechLabs/Texturion/commit/aff6673596b5f6d87eb45a7fca7a6c764bd54ca1))
* **clients:** a realtime topic lost on a live socket is asked for again ([55f25e7](https://github.com/BytechLabs/Texturion/commit/55f25e7569db98240d4567e2a07ff43c81826084)), closes [#484](https://github.com/BytechLabs/Texturion/issues/484)
* **clients:** a revoked number stops reaching you even when the leave is lost ([d6b08fe](https://github.com/BytechLabs/Texturion/commit/d6b08fe594a909c9d6f180afa52f8373cf4b553c)), closes [#483](https://github.com/BytechLabs/Texturion/issues/483)
* **clients:** an ordinary hour no longer reads as a late-night warning ([a58c700](https://github.com/BytechLabs/Texturion/commit/a58c7002aa7cee83072636ba6d0f6b9cfc6c84b3)), closes [#225](https://github.com/BytechLabs/Texturion/issues/225)
* **clients:** count the message that sends, not the one that was typed ([441896b](https://github.com/BytechLabs/Texturion/commit/441896b6aa0a7fd55774ef56d576133c0ccccfff))
* **clients:** losing access to a number refreshes what you can see, now ([a880528](https://github.com/BytechLabs/Texturion/commit/a88052875a0601493df75b1c3212b076a9063970)), closes [#480](https://github.com/BytechLabs/Texturion/issues/480)
* **clients:** stop offering to undo a STOP the customer sent ([9da7807](https://github.com/BytechLabs/Texturion/commit/9da7807b7803fa82b5a606ed1bdc576aaa7e3a6e))
* **clients:** the crew-wide lead alert is one row, on all three clients ([5406bf9](https://github.com/BytechLabs/Texturion/commit/5406bf9570b1c61e900de19a2a5b6c5d714b0092)), closes [#463](https://github.com/BytechLabs/Texturion/issues/463)
* **clients:** the map no longer serves tiles from OSM's donated servers ([94367bb](https://github.com/BytechLabs/Texturion/commit/94367bbaccb957a632daa56b3fac1102faecaa68)), closes [#428](https://github.com/BytechLabs/Texturion/issues/428)
* **compliance:** answer the Canadian A2P question, and aim it at the right mechanism ([4fbe10d](https://github.com/BytechLabs/Texturion/commit/4fbe10df9746e8acad88a0b42c2df49ccc98b4d5)), closes [#379](https://github.com/BytechLabs/Texturion/issues/379)
* **contacts:** page the history on the whole sort key, not just the clock ([a892b64](https://github.com/BytechLabs/Texturion/commit/a892b644015e77e195909bc34eb4fd733738c789)), closes [#324](https://github.com/BytechLabs/Texturion/issues/324)
* **legal:** say where a customer's voicemail is actually read ([545fde3](https://github.com/BytechLabs/Texturion/commit/545fde39a749744f8d3445f5b5462d5bf3ab63e1))
* **marketing:** the home page said we cannot answer the phone ([a54a9c3](https://github.com/BytechLabs/Texturion/commit/a54a9c35a5b69023b561e7e7411afbd225165e7c)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the site promised call forwarding the product deleted in D43 ([1961ee6](https://github.com/BytechLabs/Texturion/commit/1961ee6e1e333aafdd5c1037d5b1d85a079c9740)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **marketing:** the site told contractors we have no tasks screen ([076529b](https://github.com/BytechLabs/Texturion/commit/076529ba05af5e1e510d0f877fb651fcd5eaee1b)), closes [#491](https://github.com/BytechLabs/Texturion/issues/491)
* **messaging:** check inbound files against their bytes, and say when one is refused ([65bdff6](https://github.com/BytechLabs/Texturion/commit/65bdff6a46f83ba2377c2552b4bba6dde631814b)), closes [#317](https://github.com/BytechLabs/Texturion/issues/317)
* **onboarding:** expire abandoned drafts and credit the account step ([cd4a4cd](https://github.com/BytechLabs/Texturion/commit/cd4a4cd09702df6825400e8c851410208275034d))
* **onboarding:** stop asking for a SIN before anyone has paid ([19e0182](https://github.com/BytechLabs/Texturion/commit/19e018238ea2ca66ebc9648923626e83319cc1fa))
* **realtime:** a number you cannot reach no longer reaches your inbox ([c4eedbc](https://github.com/BytechLabs/Texturion/commit/c4eedbc5a07bf0ccfe776ecfb279751a23589304)), closes [#484](https://github.com/BytechLabs/Texturion/issues/484)
* tell a leaving customer their number goes to another business ([ed64782](https://github.com/BytechLabs/Texturion/commit/ed64782f4ba1d6b74abadcce9a7c3afcba790c20)), closes [#413](https://github.com/BytechLabs/Texturion/issues/413)
* **web:** compliance page states how a customer's local time is found ([4b16ea7](https://github.com/BytechLabs/Texturion/commit/4b16ea7274c543116f614f3482efccc232105d55)), closes [#355](https://github.com/BytechLabs/Texturion/issues/355)
* **web:** giving up on a number's realtime topic is now slow, not permanent ([28d1c1b](https://github.com/BytechLabs/Texturion/commit/28d1c1b5e5f6ea310339eb175b97dff4db710b7c)), closes [#483](https://github.com/BytechLabs/Texturion/issues/483)
* **web:** lead chasing is one switch among the notification settings ([05049dc](https://github.com/BytechLabs/Texturion/commit/05049dc57060ad9948543239628ad3c97b2a4e1a)), closes [#463](https://github.com/BytechLabs/Texturion/issues/463)
* **web:** llms.txt no longer says the AI features are off when they ship on ([cb05fde](https://github.com/BytechLabs/Texturion/commit/cb05fdeca51bc5a163b5f3d456f2aa74fb0fa908)), closes [#434](https://github.com/BytechLabs/Texturion/issues/434)
* **web:** native sign-in captcha no longer gets bounced off the app host ([611da03](https://github.com/BytechLabs/Texturion/commit/611da0316e7aae2575a94d0d3c25f41eefff3bf3)), closes [#258](https://github.com/BytechLabs/Texturion/issues/258)
* **web:** the $29 headline cannot travel without its crew size ([322624c](https://github.com/BytechLabs/Texturion/commit/322624c6c99e7f6189b479652f5db5a8fc71dddb))
* **web:** the divider above the pricing guarantee was invisible ([ba5f157](https://github.com/BytechLabs/Texturion/commit/ba5f1577afe219c37718658b595e75249b008ad7)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** the homepage animation was still painting the old blue ([d432e53](https://github.com/BytechLabs/Texturion/commit/d432e53d962104694c7f9fb15200e1da5833e19c)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** the machine-readable product summary can no longer drift silently ([b302e2e](https://github.com/BytechLabs/Texturion/commit/b302e2e1091109f727ba384709d327208bd660fa))
* **web:** the shared-link preview stops advertising a design we retired ([14d1c31](https://github.com/BytechLabs/Texturion/commit/14d1c317ebb979aaa5027b60ca1e0453e521926c))
* **web:** the sidebar's quiet nav items had no colour at all ([5259d29](https://github.com/BytechLabs/Texturion/commit/5259d2929b6abc41764f1982c9a36c348d7d8f96)), closes [#362](https://github.com/BytechLabs/Texturion/issues/362)
* **web:** the site no longer promises US texting is live the minute you sign up ([35de010](https://github.com/BytechLabs/Texturion/commit/35de010925f92feb332bcdba6c7fbdd7d5cd512c)), closes [#437](https://github.com/BytechLabs/Texturion/issues/437)
* **web:** the sub-processors page says what we actually send to AI ([218a254](https://github.com/BytechLabs/Texturion/commit/218a2541e23b6d670bb44a048fcddfb10c2f7c15))
* **web:** the submission check reads the company's embedded registration too ([59dd385](https://github.com/BytechLabs/Texturion/commit/59dd3857c418ab8aab4b81577af4c7c5e9dd364f))

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
