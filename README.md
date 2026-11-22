# Conversation navigation before and after

Screenshots for [#1081](https://github.com/BytechLabs/Texturion/issues/1081). Web and Android baselines use the signed-in QA rig. Android screenshots mask the rig's phone numbers. The web candidate uses seeded local data and the iOS Simulator uses its own fixtures.

## Web

Phone 390 × 844 and desktop 1440 × 900. Navigation crops show the hierarchy. Scheduled captures show the destination and current state.

| Language | Theme | Width | Before | After | Scheduled after | Copy and switch after |
| --- | --- | --- | --- | --- | --- | --- |
| English | light | phone | [Messages](web/before/en-CA-light-phone.png) | [Messages](web/after/en-CA-light-phone-messages.png) | [Scheduled](web/after/en-CA-light-phone-scheduled.png) | [Selected number](web/after/en-CA-light-phone-copy.png) |
| English | light | desktop | [Messages](web/before/en-CA-light-desktop.png) | [Messages](web/after/en-CA-light-desktop-messages.png) | [Scheduled](web/after/en-CA-light-desktop-scheduled.png) | [Selected number](web/after/en-CA-light-desktop-copy.png) |
| English | dark | phone | [Messages](web/before/en-CA-dark-phone.png) | [Messages](web/after/en-CA-dark-phone-messages.png) | [Scheduled](web/after/en-CA-dark-phone-scheduled.png) | [Selected number](web/after/en-CA-dark-phone-copy.png) |
| English | dark | desktop | [Messages](web/before/en-CA-dark-desktop.png) | [Messages](web/after/en-CA-dark-desktop-messages.png) | [Scheduled](web/after/en-CA-dark-desktop-scheduled.png) | [Selected number](web/after/en-CA-dark-desktop-copy.png) |
| Canadian French | light | phone | [Messages](web/before/fr-CA-light-phone.png) | [Messages](web/after/fr-CA-light-phone-messages.png) | [Scheduled](web/after/fr-CA-light-phone-scheduled.png) | [Selected number](web/after/fr-CA-light-phone-copy.png) |
| Canadian French | light | desktop | [Messages](web/before/fr-CA-light-desktop.png) | [Messages](web/after/fr-CA-light-desktop-messages.png) | [Scheduled](web/after/fr-CA-light-desktop-scheduled.png) | [Selected number](web/after/fr-CA-light-desktop-copy.png) |
| Canadian French | dark | phone | [Messages](web/before/fr-CA-dark-phone.png) | [Messages](web/after/fr-CA-dark-phone-messages.png) | [Scheduled](web/after/fr-CA-dark-phone-scheduled.png) | [Selected number](web/after/fr-CA-dark-phone-copy.png) |
| Canadian French | dark | desktop | [Messages](web/before/fr-CA-dark-desktop.png) | [Messages](web/after/fr-CA-dark-desktop-messages.png) | [Scheduled](web/after/fr-CA-dark-desktop-scheduled.png) | [Selected number](web/after/fr-CA-dark-desktop-copy.png) |

## Android

API 36 at 320 × 640 and 840 × 920. [Clipboard confirmation](android/after/en-CA-light-phone-held-number.png).

| Language | Theme | Width | Before | After | Scheduled after |
| --- | --- | --- | --- | --- | --- |
| English | light | phone | [Messages](android/before/en-CA-light-phone.png) | [Messages](android/after/en-CA-light-phone-messages.png) | [Scheduled](android/after/en-CA-light-phone-scheduled.png) |
| English | light | wide | [Messages](android/before/en-CA-light-wide.png) | [Messages](android/after/en-CA-light-wide-messages.png) | [Scheduled](android/after/en-CA-light-wide-scheduled.png) |
| English | dark | phone | [Messages](android/before/en-CA-dark-phone.png) | [Messages](android/after/en-CA-dark-phone-messages.png) | [Scheduled](android/after/en-CA-dark-phone-scheduled.png) |
| English | dark | wide | [Messages](android/before/en-CA-dark-wide.png) | [Messages](android/after/en-CA-dark-wide-messages.png) | [Scheduled](android/after/en-CA-dark-wide-scheduled.png) |
| Canadian French | light | phone | [Messages](android/before/fr-CA-light-phone.png) | [Messages](android/after/fr-CA-light-phone-messages.png) | [Scheduled](android/after/fr-CA-light-phone-scheduled.png) |
| Canadian French | light | wide | [Messages](android/before/fr-CA-light-wide.png) | [Messages](android/after/fr-CA-light-wide-messages.png) | [Scheduled](android/after/fr-CA-light-wide-scheduled.png) |
| Canadian French | dark | phone | [Messages](android/before/fr-CA-dark-phone.png) | [Messages](android/after/fr-CA-dark-phone-messages.png) | [Scheduled](android/after/fr-CA-dark-phone-scheduled.png) |
| Canadian French | dark | wide | [Messages](android/before/fr-CA-dark-wide.png) | [Messages](android/after/fr-CA-dark-wide-messages.png) | [Scheduled](android/after/fr-CA-dark-wide-scheduled.png) |

## iOS

iPhone 17 Pro Simulator. The app targets iPhone. [Baseline workflow](https://github.com/BytechLabs/Texturion/actions/runs/44972616852) · [Candidate workflow](https://github.com/BytechLabs/Texturion/actions/runs/45054047216).

| Language | Theme | Before |
| --- | --- | --- |
| English | light | [Messages](ios/before/en-light.png) |
| English | dark | [Messages](ios/before/en-dark.png) |
| Canadian French | light | [Messages](ios/before/fr-CA-light.png) |
| Canadian French | dark | [Messages](ios/before/fr-CA-dark.png) |
