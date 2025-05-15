# [3.0.0-alpha.28](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.27...v3.0.0-alpha.28) (2025-05-15)


### Features

* Support uploading starting image and ControlNet input image before creating a project ([4fd8a5a](https://github.com/Sogni-AI/sogni-client/commit/4fd8a5a3597e7b3bb85c4a8c94cd2df798ca6bfe))

# [3.0.0-alpha.27](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.26...v3.0.0-alpha.27) (2025-05-14)


### Features

* Allow setting token type for image enhancement ([7420274](https://github.com/Sogni-AI/sogni-client/commit/7420274caf852b078d47e008b6065da70a456714))

# [3.0.0-alpha.26](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.25...v3.0.0-alpha.26) (2025-05-14)


### Bug Fixes

* Pass tokenType to jobRequest message. Make tokenType optional for project estimation ([9550d76](https://github.com/Sogni-AI/sogni-client/commit/9550d76ee3d40fb4321a157d0a5feb0fb680f183))

# [3.0.0-alpha.25](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.24...v3.0.0-alpha.25) (2025-05-13)


### Features

* Remove blockchain provider since SDK does not need to call Base ([d5f8609](https://github.com/Sogni-AI/sogni-client/commit/d5f8609f29b9f9843913ecaf514516f490a60c61))

# [3.0.0-alpha.24](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.23...v3.0.0-alpha.24) (2025-05-13)


### Features

* add tokenType to transaction list ([ee5951e](https://github.com/Sogni-AI/sogni-client/commit/ee5951ef9014ec6eed6a5b52acb5b8b1c5d1227d))

# [3.0.0-alpha.23](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.22...v3.0.0-alpha.23) (2025-05-13)


### Features

* add tokenType to estimateCost and estimateEnhancementCost methods ([1c97258](https://github.com/Sogni-AI/sogni-client/commit/1c97258facb2ddd687361a5172d5318329a70c43))


### BREAKING CHANGES

* client.projects.estimateCost and client.projects.estimateEnhancementCost signature changed

# [3.0.0-alpha.22](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.21...v3.0.0-alpha.22) (2025-05-12)


### Features

* Bump PROTOCOL_VERSION ([6e5f6b9](https://github.com/Sogni-AI/sogni-client/commit/6e5f6b91870fbd557ce235d0508216c1b4e93cad))

# [3.0.0-alpha.21](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.20...v3.0.0-alpha.21) (2025-05-12)


### Features

* add TokenType export and update LIB_VERSION from package.json ([f6110b5](https://github.com/Sogni-AI/sogni-client/commit/f6110b521715a076a7abb3010c68fbde8ea64b71))

# [3.0.0-alpha.20](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.19...v3.0.0-alpha.20) (2025-05-12)


### Features

* update balance API and data format to support multiple token types. Support passing token type in Project request ([f227467](https://github.com/Sogni-AI/sogni-client/commit/f22746748f7da3df8dfd9f8fd0cb90a8f7269cac))


### BREAKING CHANGES

* Balance data format has changed

# [3.0.0-alpha.19](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.18...v3.0.0-alpha.19) (2025-05-10)


### Features

* emit jobStarted, jobCompleted, and jobFailed events for better job tracking ([0e3bb33](https://github.com/Sogni-AI/sogni-client/commit/0e3bb33703868a3491edfac2c9f08325db0eb278))

# [3.0.0-alpha.18](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.17...v3.0.0-alpha.18) (2025-05-09)


### Features

* add support for receiving positivePrompt, negativePrompt, and jobIndex from jobInitiating and jobStarted events, these are useful for dynamic prompt result mapping ([d9873fa](https://github.com/Sogni-AI/sogni-client/commit/d9873fad77709afb72a02eb52ee5fd95e72244be))

# [3.0.0-alpha.17](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.16...v3.0.0-alpha.17) (2025-04-30)


### Bug Fixes

* Do not mark project as completed if not all jobs started yet ([812e5ac](https://github.com/Sogni-AI/sogni-client/commit/812e5accd8605a6a742beb16a53bca2be50b9a81))

# [3.0.0-alpha.16](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.15...v3.0.0-alpha.16) (2025-04-24)


### Bug Fixes

* Discard enhancement project before starting new one ([4293b2b](https://github.com/Sogni-AI/sogni-client/commit/4293b2b535ed8cfe76ce307de71c99bec799bd79))

# [3.0.0-alpha.15](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.14...v3.0.0-alpha.15) (2025-04-24)


### Bug Fixes

* Prevent job progress going down ([5cf69d3](https://github.com/Sogni-AI/sogni-client/commit/5cf69d375d3a284964ba423c4287d592538cd273))

# [3.0.0-alpha.14](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.13...v3.0.0-alpha.14) (2025-04-24)


### Features

* Refactor image enhancement logic ([6728875](https://github.com/Sogni-AI/sogni-client/commit/67288759637c4b22266455ce1f1220d2590d7592))

# [3.0.0-alpha.13](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.12...v3.0.0-alpha.13) (2025-04-24)


### Features

* Add prompt and style overrides for image enhancer ([35cd4a0](https://github.com/Sogni-AI/sogni-client/commit/35cd4a017361f919d42a2568fff6e2e7b4367949))

# [3.0.0-alpha.12](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.11...v3.0.0-alpha.12) (2025-04-23)


### Bug Fixes

* Copy size preset when enhancing image ([06ab629](https://github.com/Sogni-AI/sogni-client/commit/06ab629a9b10377c87406817d1e72a0cd35bd025))

# [3.0.0-alpha.11](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.10...v3.0.0-alpha.11) (2025-04-23)


### Features

* Image enhancement with Flux model ([82488e7](https://github.com/Sogni-AI/sogni-client/commit/82488e7658b56902cee25e58bc1763c1392c5d46))

# [3.0.0-alpha.11](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.10...v3.0.0-alpha.11) (2025-04-20)


### Features

* Add support for InstantID ControlNet ([2b032a8](https://github.com/Sogni-AI/sogni-client/commit/dbaa1e464d15635dc5e7db6c785bf25b0e8788a7))

# [3.0.0-alpha.10](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.9...v3.0.0-alpha.10) (2025-04-11)


### Features

* Add support for toast message events ([2b032a8](https://github.com/Sogni-AI/sogni-client/commit/2b032a83b3c28798a4df692c1cb6f090915191a6))

# [3.0.0-alpha.9](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.8...v3.0.0-alpha.9) (2025-04-07)


### Bug Fixes

* Set scheduler and timeStepSpacing to null by default ([ccc1fc8](https://github.com/Sogni-AI/sogni-client/commit/ccc1fc842b408f905fd786807be5b5df8895690b))

# [3.0.0-alpha.8](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.7...v3.0.0-alpha.8) (2025-04-02)


### Bug Fixes

* Fix project sync attempt counter ([b112c06](https://github.com/Sogni-AI/sogni-client/commit/b112c064b443186b1992a80da5612af001919107))

# [3.0.0-alpha.7](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.6...v3.0.0-alpha.7) (2025-04-02)


### Features

* Set project to error state if failed to sync it to server after not receiving any socket updates ([7ac63c4](https://github.com/Sogni-AI/sogni-client/commit/7ac63c40c5441578cc7beca4363a5301e6450fc3))

# [3.0.0-alpha.6](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.5...v3.0.0-alpha.6) (2025-04-02)


### Features

* Add new leaderboard types ([d6d3fb8](https://github.com/Sogni-AI/sogni-client/commit/d6d3fb8a7c5a84ff089d6b51bc448da26821174a))

# [3.0.0-alpha.5](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.4...v3.0.0-alpha.5) (2025-03-27)


### Features

* Add turnstile token parameter to claimReward ([a96f5e2](https://github.com/Sogni-AI/sogni-client/commit/a96f5e2b22fd879a717aae1c3fe6f60ad675d031))

# [3.0.0-alpha.4](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.3...v3.0.0-alpha.4) (2025-03-25)


### Features

* Allow insecure socket connections ([5da2b0a](https://github.com/Sogni-AI/sogni-client/commit/5da2b0abb57e0e8ab7c7c5de449ea7a04183b753))

# [3.0.0-alpha.3](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2025-03-21)


### Bug Fixes

* Fix job.getResultUrl() bug ([ea90083](https://github.com/Sogni-AI/sogni-client/commit/ea900831cd578c5962236b70564cab0da4f2f7a8))

# [3.0.0-alpha.2](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2025-03-21)


### Features

* Add job.getResultUrl() method to retrieve fresh download URL for a job ([82ce8d3](https://github.com/Sogni-AI/sogni-client/commit/82ce8d3cc9681800616185aac50e8f2102314ed4))

# [3.0.0-alpha.1](https://github.com/Sogni-AI/sogni-client/compare/v2.1.0-alpha.1...v3.0.0-alpha.1) (2025-03-17)


### Features

* Cloudflare Turnstile token is required during signup ([768b9c8](https://github.com/Sogni-AI/sogni-client/commit/768b9c8a46f05f7b196976d3a7aa8a1e512ca172))


### BREAKING CHANGES

* Signup signature is changed.Turnstile token is required for Signup

# [2.1.0-alpha.1](https://github.com/Sogni-AI/sogni-client/compare/v2.0.2...v2.1.0-alpha.1) (2025-02-04)


### Features

* Add basic ControlNet support ([220991d](https://github.com/Sogni-AI/sogni-client/commit/220991db5b16740b159d2cb0c3e746141fa4906f))

## [2.0.2](https://github.com/Sogni-AI/sogni-client/compare/v2.0.1...v2.0.2) (2025-02-04)


### Bug Fixes

* False "completed" event for project when there is lack of free workers ([e5d546d](https://github.com/Sogni-AI/sogni-client/commit/e5d546dfbe0cb692ec120156e1e90c3787def951))

## [2.0.1](https://github.com/Sogni-AI/sogni-client/compare/v2.0.0...v2.0.1) (2025-01-29)


### Bug Fixes

* Update autogenerated docs ([f470102](https://github.com/Sogni-AI/sogni-client/commit/f47010299ab4fd8943cd037fbf1dba56e323cada))

# [2.0.0](https://github.com/Sogni-AI/sogni-client/compare/v1.1.0...v2.0.0) (2025-01-29)


### Features

* Refresh token, output image size, project cancellation ([0a308c7](https://github.com/Sogni-AI/sogni-client/commit/0a308c759293a9a7a7efc3e4075434a316424c00))


### BREAKING CHANGES

* Changed signature for `client.account.setToken`
Before:
`client.account.setToken(username, token);`
Now:
`client.account.setToken(username, {token, refreshToken});`

# [1.1.0](https://github.com/Sogni-AI/sogni-client/compare/v1.0.2...v1.1.0) (2025-01-29)


### Features

* Custom output image size ([fe8957c](https://github.com/Sogni-AI/sogni-client/commit/fe8957cdc8b280b34dcbe5d395ffeed6de91fa56))
* Project cancellation ([00f704e](https://github.com/Sogni-AI/sogni-client/commit/00f704e2ef43164d024b50f30c8ea0c33c1a96cf))

## [1.0.2](https://github.com/Sogni-AI/sogni-client/compare/v1.0.1...v1.0.2) (2025-01-29)


### Bug Fixes

* Another fix for semantic-release gitnub plugin configuration ([b0e14b9](https://github.com/Sogni-AI/sogni-client/commit/b0e14b9a56c7c12d8d36235bd7ffaec204ed71af))

## [1.0.1](https://github.com/Sogni-AI/sogni-client/compare/v1.0.0...v1.0.1) (2025-01-29)


### Bug Fixes

* Fix semantic-release gitnub plugin configuration ([0e298b9](https://github.com/Sogni-AI/sogni-client/commit/0e298b9bb105a3b846f0c696be2147072b7097eb))

# 1.0.0 (2025-01-29)


### Features

* Add semantic-release ([54587c5](https://github.com/Sogni-AI/sogni-client/commit/54587c52c4a5c5d46ce111f625119087b06606e1))
