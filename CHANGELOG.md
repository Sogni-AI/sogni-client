# [4.0.0-alpha.68](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.67...v4.0.0-alpha.68) (2026-02-24)


### Bug Fixes

* add cost estimation, tokenType billing, and worker tracking to Chat API ([8c1059e](https://github.com/Sogni-AI/sogni-client/commit/8c1059ee2bb43505d1e77abc3bccdce73910cb38))

# [4.0.0-alpha.67](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.66...v4.0.0-alpha.67) (2026-02-24)


### Features

* add API key authentication support ([b7c1187](https://github.com/Sogni-AI/sogni-client/commit/b7c11879315e311afa6a668423de0e848e41c2fc))

# [4.0.0-alpha.66](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.65...v4.0.0-alpha.66) (2026-02-20)


### Bug Fixes

* Allow 20 seconds duration videos for LTX-2 ([d7ad669](https://github.com/Sogni-AI/sogni-client/commit/d7ad669fd56c0f64f9a8f2a0fa4b4dbe5c4a9683))

# [4.0.0-alpha.65](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.64...v4.0.0-alpha.65) (2026-02-17)


### Bug Fixes

* Add `AudioProjectParams` to exports in `index.ts` ([bdbbca7](https://github.com/Sogni-AI/sogni-client/commit/bdbbca7dfe5dde5dd3e379a8209db1b1c41eaaa4))

# [4.0.0-alpha.64](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.63...v4.0.0-alpha.64) (2026-02-17)


### Features

* Add ACE-Step 1.5 audio generation documentation ([c02c80b](https://github.com/Sogni-AI/sogni-client/commit/c02c80be31067c6b929fea85bec1898cd26aff3a))

# [4.0.0-alpha.63](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.62...v4.0.0-alpha.63) (2026-02-16)


### Features

* Add audio cost estimation API and image download content type support ([784ccca](https://github.com/Sogni-AI/sogni-client/commit/784ccca38c8b4031415ba18158dbdda53dbb0ed2))
* Add audio generation support and LTX-2 ia2v/a2v/v2v workflows ([7d1f2dc](https://github.com/Sogni-AI/sogni-client/commit/7d1f2dcd4cac6c8750b46d88f04fb87077d379a6))

# [4.0.0-alpha.62](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.61...v4.0.0-alpha.62) (2026-02-12)


### Features

* sam2Coordinates option for Animate Replace workflow ([9275249](https://github.com/Sogni-AI/sogni-client/commit/9275249370fe1bb34732dece0e2c814c35d56dcf))

# [4.0.0-alpha.61](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.60...v4.0.0-alpha.61) (2026-02-03)


### Bug Fixes

* Correct video frame calculation for WAN vs LTX-2 models ([9127498](https://github.com/Sogni-AI/sogni-client/commit/9127498935e68f352850871ed9f4115234df9e0d))

# [4.0.0-alpha.60](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.59...v4.0.0-alpha.60) (2026-02-02)


### Bug Fixes

* Update lodash types to 4.17.23 ([336e382](https://github.com/Sogni-AI/sogni-client/commit/336e382d9f85aecfa69ae11e21b80758c8c08575))

# [4.0.0-alpha.59](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.58...v4.0.0-alpha.59) (2026-02-02)


### Bug Fixes

* Optimize lodash imports ([86479d0](https://github.com/Sogni-AI/sogni-client/commit/86479d0713bbb361811c98445b0c330cdc49bcc2))

# [4.0.0-alpha.58](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.57...v4.0.0-alpha.58) (2026-01-29)


### Bug Fixes

* refactor Video controlnet schema to match existing image controlnet schema ([b9e01f5](https://github.com/Sogni-AI/sogni-client/commit/b9e01f5c21449259e47f45b16eb4f7e65fdf7c51))

# [4.0.0-alpha.57](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.56...v4.0.0-alpha.57) (2026-01-28)


### Bug Fixes

* allow optional referenceImage for v2v pose control ([183b324](https://github.com/Sogni-AI/sogni-client/commit/183b324c0e1c74f27041c46e666771a95102061c))

# [4.0.0-alpha.56](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.55...v4.0.0-alpha.56) (2026-01-28)


### Features

* add LTX-2 video-to-video ControlNet workflow support ([2dc2169](https://github.com/Sogni-AI/sogni-client/commit/2dc2169190e2adfb94a452eecfe209105dba95dd))

# [4.0.0-alpha.55](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.54...v4.0.0-alpha.55) (2026-01-27)


### Features

* LTX-2 variable FPS 1-60 with improved UX flow ([8cf63fd](https://github.com/Sogni-AI/sogni-client/commit/8cf63fd790e7890baaeffb861e618c641bcaf7c7))

# [4.0.0-alpha.54](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.53...v4.0.0-alpha.54) (2026-01-26)


### Bug Fixes

* make negativePrompt and stylePrompt optional ([5e422c3](https://github.com/Sogni-AI/sogni-client/commit/5e422c3d310df2f87edee3ad19df1ed57efff088))


### Features

* add trimEndFrame parameter for video stitching ([985d13b](https://github.com/Sogni-AI/sogni-client/commit/985d13bad9576b01388d1e58450cec8d585d9134))

# [4.0.0-alpha.53](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.52...v4.0.0-alpha.53) (2026-01-25)


### Features

* Support Etherlink ([57eaee3](https://github.com/Sogni-AI/sogni-client/commit/57eaee39c18efd26732f9ce735a42b414bf34e87))


### BREAKING CHANGES

* Account balance data format changed, instead of `unclaimed`, now it will be `relaxedUnclaimed` and `fastUnclaimed`

# [4.0.0-alpha.52](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.51...v4.0.0-alpha.52) (2026-01-22)


### Bug Fixes

* Lora schema update, LTX-2 video new default props ([bf1593f](https://github.com/Sogni-AI/sogni-client/commit/bf1593fa6c819aef6565bc096ba55e166bb8cc52))

# [4.0.0-alpha.51](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.50...v4.0.0-alpha.51) (2026-01-20)


### Bug Fixes

* Add LTX-2 video model detection support ([7a312d5](https://github.com/Sogni-AI/sogni-client/commit/7a312d560f4169c2593719cefb4b4abf0878bf9b))


### Features

* Add img2img support for Qwen Image 2512 models and improve workflows ([46324fd](https://github.com/Sogni-AI/sogni-client/commit/46324fde6043cd241bc41ee40e480a7064664575))

# [4.0.0-alpha.50](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.49...v4.0.0-alpha.50) (2026-01-16)


### Bug Fixes

* Handle logout errors gracefully and log warnings for 401 responses ([ba9b2ac](https://github.com/Sogni-AI/sogni-client/commit/ba9b2acc990e684fb59d7ba17e23dc7a3bebadf4))

# [4.0.0-alpha.49](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.48...v4.0.0-alpha.49) (2026-01-12)


### Bug Fixes

* Improve error logging for failed job result URL generation ([e69ae09](https://github.com/Sogni-AI/sogni-client/commit/e69ae0970fc995adcdf4625246eb029c45cb5ea4))

# [4.0.0-alpha.48](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.47...v4.0.0-alpha.48) (2026-01-12)


### Bug Fixes

* Add 'Discrete Flow Sampler (SD3)' to sampler alias ([460b3c2](https://github.com/Sogni-AI/sogni-client/commit/460b3c21c516b1f395041ff588f06f793480cdb1))

# [4.0.0-alpha.47](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.46...v4.0.0-alpha.47) (2026-01-10)


### Features

* add support for up to 6 context images for Flux.2 Dev ([3096fe6](https://github.com/Sogni-AI/sogni-client/commit/3096fe62f155939e7a044a07f7696066e9f1e6d7))

# [4.0.0-alpha.46](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.45...v4.0.0-alpha.46) (2026-01-09)


### Features

* Refactor sampler and scheduler handling; remove legacy definitions and centralize validation ([29b0905](https://github.com/Sogni-AI/sogni-client/commit/29b09056ba578e577d557754bae05bbb1671af00))


### BREAKING CHANGES

* Enums and type definitions for sampler and scheduler params are removed

Now scheduler and sampler params are strings. `const modelOptions = await sogni.projects.getModelOptions(modelId)` can be used to pull options for each model.

# [4.0.0-alpha.45](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.44...v4.0.0-alpha.45) (2026-01-09)


### Features

* add support for up to 6 contextImage for flux.2 [dev], add example script starting-image option for z-image and image size cap to ~4mp for new image models ([57c902c](https://github.com/Sogni-AI/sogni-client/commit/57c902c1b5d29c702a13ce58759af21f5e815eb4))

# [4.0.0-alpha.44](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.43...v4.0.0-alpha.44) (2026-01-08)


### Bug Fixes

* videoStart release ([d9dd123](https://github.com/Sogni-AI/sogni-client/commit/d9dd1234c75e5166a94ef2aa7a705f6679c3d3ec))

# [4.0.0-alpha.43](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.42...v4.0.0-alpha.43) (2026-01-07)


### Bug Fixes

* very long running video progress jobs aborting prematurely ([8860ae8](https://github.com/Sogni-AI/sogni-client/commit/8860ae87bfb8104a64585c3107f6d4da1c3b4615))

# [4.0.0-alpha.42](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.41...v4.0.0-alpha.42) (2026-01-07)


### Bug Fixes

* fix for passing video s2v audioStart and audioDuration. Fix for broken animate-replace in examples due to default sam2 coordinates ([7b525cd](https://github.com/Sogni-AI/sogni-client/commit/7b525cd50d60ec8b3884db80ee39dca25e1aca97))

# [4.0.0-alpha.41](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.40...v4.0.0-alpha.41) (2026-01-06)


### Features

* example script workflow enhancements ([94d14e4](https://github.com/Sogni-AI/sogni-client/commit/94d14e42a121976b1090fe797734f2f76e57da02))

# [4.0.0-alpha.40](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.39...v4.0.0-alpha.40) (2026-01-06)


### Bug Fixes

* res_multistep support in SupportedComfySamplers to fix support for z-image. /examples script enhancements ([332e7b1](https://github.com/Sogni-AI/sogni-client/commit/332e7b1280272e05c7d897de22edea61482f5b7c))

# [4.0.0-alpha.39](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.38...v4.0.0-alpha.39) (2026-01-05)


### Bug Fixes

* Add ForgeSampler, ComfySampler, ForgeScheduler, and ComfyScheduler to exports ([ad24b32](https://github.com/Sogni-AI/sogni-client/commit/ad24b326904f7ad67f43c34a0b758ce64e84a8f1))

# [4.0.0-alpha.38](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.37...v4.0.0-alpha.38) (2026-01-05)


### Features

* Support Qwen, Z Image and Flux 2 models ([fd3acb7](https://github.com/Sogni-AI/sogni-client/commit/fd3acb7bdce5d7c81750e58fb79d14cf4f5f0b2f))


### BREAKING CHANGES

* `SupportedSamplers` and `SupportedSchedulers` removed
`SupportedSamplers` and `SupportedSchedulers` are replaced with `SupportedComfySchedulers`, `SupportedComfySamplers`, `SupportedForgeSchedulers`, `SupportedForgeSamplers`

* fix: Prettier formatting

# [4.0.0-alpha.37](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.36...v4.0.0-alpha.37) (2026-01-05)


### Bug Fixes

* Replace frames with duration in project cost estimation ([b6c576e](https://github.com/Sogni-AI/sogni-client/commit/b6c576e70b66d2604441e1bd8e013fa435c0c099))

# [4.0.0-alpha.36](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.35...v4.0.0-alpha.36) (2026-01-05)


### Features

* Add support for video duration options with validation and deprecate frames property ([fa11d79](https://github.com/Sogni-AI/sogni-client/commit/fa11d7905ef249a2e75a6d96c8a2bedda24005df))

# [4.0.0-alpha.35](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.34...v4.0.0-alpha.35) (2025-12-31)


### Bug Fixes

* allow i2v workflow to use either referenceImage or referenceImageEnd ([b9f08ef](https://github.com/Sogni-AI/sogni-client/commit/b9f08efa91e92f58280b923c5815c9b6645c5452))

# [4.0.0-alpha.34](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.33...v4.0.0-alpha.34) (2025-12-30)


### Features

* Add VideoProjectParams optional teacacheThreshold support ([7a68d4c](https://github.com/Sogni-AI/sogni-client/commit/7a68d4ccc8db8fa1ed410452321468d434927bd1))

# [4.0.0-alpha.33](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.32...v4.0.0-alpha.33) (2025-12-19)


### Bug Fixes

* Add numberOfMedia parameter to video project estimation request ([b762e61](https://github.com/Sogni-AI/sogni-client/commit/b762e6130c94a1aa192047c9b14f54dc1acb0191))

# [4.0.0-alpha.32](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.31...v4.0.0-alpha.32) (2025-12-18)


### Bug Fixes

* Prevent potential memory leak in Project.waitForCompletion ([010a1de](https://github.com/Sogni-AI/sogni-client/commit/010a1decd1f5168275c34f95ccdb7ca8092ac3e5))

# [4.0.0-alpha.31](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.30...v4.0.0-alpha.31) (2025-12-17)


### Features

* Add project and job ETA properties ([66024cc](https://github.com/Sogni-AI/sogni-client/commit/66024cc26dac51bbd45dc5b4d7e68c5963f8c178))

# [4.0.0-alpha.30](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.29...v4.0.0-alpha.30) (2025-12-17)


### Features

* Add video project cost estimation ([33c7533](https://github.com/Sogni-AI/sogni-client/commit/33c7533b90bfe7c23c465b38867d184b00561112))

# [4.0.0-alpha.29](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.28...v4.0.0-alpha.29) (2025-12-16)


### Bug Fixes

* wan sample scripts for s2v and animate should all support custom prompts ([5a2dbf9](https://github.com/Sogni-AI/sogni-client/commit/5a2dbf963c8ff411dece0dec87b52117a0baea23))

# [4.0.0-alpha.28](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.27...v4.0.0-alpha.28) (2025-12-15)


### Features

* Expose array of projects that SogniClient instance is tracking currently ([38b6c0e](https://github.com/Sogni-AI/sogni-client/commit/38b6c0ec7ab3e6f621e42f9e512ede98f4b3a9da))

# [4.0.0-alpha.27](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.26...v4.0.0-alpha.27) (2025-12-12)


### Features

* Add ability to query balance for Etherlink wallet ([60ef11b](https://github.com/Sogni-AI/sogni-client/commit/60ef11beec443837a044e24c11014bef8f804275))

# [4.0.0-alpha.26](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.25...v4.0.0-alpha.26) (2025-12-12)


### Bug Fixes

* Comfy / Video jobs leverage jobETA for lastUpdate to ensure jobs do not have a client-side timeout prematurely ([db5e2a6](https://github.com/Sogni-AI/sogni-client/commit/db5e2a62256ccb0f704a50fdf7e1e0556e2aecaa))


### Features

* ensure video model passed with and height are at least 480 ([d0156aa](https://github.com/Sogni-AI/sogni-client/commit/d0156aa84785f98c60ee09e7c733e62940eb0b9e))

# [4.0.0-alpha.25](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.24...v4.0.0-alpha.25) (2025-12-11)


### Bug Fixes

* Add sample parameters for Flux ([8e25924](https://github.com/Sogni-AI/sogni-client/commit/8e25924476a1faf1ac432a6490b4d52ac0cf4898))

# [4.0.0-alpha.24](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.23...v4.0.0-alpha.24) (2025-12-11)


### Features

* final round of doc / example enhancements with new steps support for Wan video models ([95d5dfb](https://github.com/Sogni-AI/sogni-client/commit/95d5dfb61d5ed2878c04cd6cf7a0d75d9d0754e1))

# [4.0.0-alpha.23](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.22...v4.0.0-alpha.23) (2025-12-10)


### Features

* Add credential management system for video examples ([e7fc1ab](https://github.com/Sogni-AI/sogni-client/commit/e7fc1abf85d32995c64c48a5f861cb3f99a4793b))
* Enhance video example scripts with improved UX ([6a70c26](https://github.com/Sogni-AI/sogni-client/commit/6a70c26e2b30b5be7bcae88171bbd3956bbe91af))

# [4.0.0-alpha.22](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.21...v4.0.0-alpha.22) (2025-12-10)


### Features

* Video support added with Wan 2.2 14B FP8 models supporting five workflows: text-to-video (t2v), image-to-video (i2v), sound-to-video (s2v), animate-move, and animate-replace ([e00e1e7](https://github.com/Sogni-AI/sogni-client/commit/e00e1e7879962047a6950013d53aa83748a66021))


### BREAKING CHANGES

* Project creation parameters changed
- `type` is required when calling `sogni.projects.create(params)`, valid values are `image` and `video`. See code examples below.
- `numberOfImages` renamed to `numberOfMedia`
- `hasResultImage` in `Job` class is now `hasResultMedia`
- `Job` and `Project` classes now have `type` property  that can be `image` or `video`

# [4.0.0-alpha.21](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.20...v4.0.0-alpha.21) (2025-12-04)


### Bug Fixes

* Fix TypeScript error ([30ff62a](https://github.com/Sogni-AI/sogni-client/commit/30ff62ad5ccb3624bf8a26b70f65b4c0daa9c6ff))

# [4.0.0-alpha.20](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.19...v4.0.0-alpha.20) (2025-12-04)


### Bug Fixes

* Better socket coordinator implementation. Handle socket disconnection properly ([2a1a922](https://github.com/Sogni-AI/sogni-client/commit/2a1a922a0dd41446c1dcf6ffeaccfe54556af5bb))

# [4.0.0-alpha.19](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.18...v4.0.0-alpha.19) (2025-12-03)


### Bug Fixes

* Connect socket if client tries to send the message ([b5fa7bc](https://github.com/Sogni-AI/sogni-client/commit/b5fa7bc9599f30ff575521e76d76d42f031769fc))

# [4.0.0-alpha.18](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.17...v4.0.0-alpha.18) (2025-12-02)


### Bug Fixes

* Pass error iin message ack ([7b73d87](https://github.com/Sogni-AI/sogni-client/commit/7b73d87fdd27634b75fe5aa0bbba43415d6e7dce))

# [4.0.0-alpha.17](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.16...v4.0.0-alpha.17) (2025-12-02)


### Bug Fixes

* Initialization bug ([42b4e26](https://github.com/Sogni-AI/sogni-client/commit/42b4e26dad8f634eb6c17d172081d6c3d03a3d41))

# [4.0.0-alpha.16](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.15...v4.0.0-alpha.16) (2025-12-02)


### Bug Fixes

* Make shared socket connection optional ([7ee2311](https://github.com/Sogni-AI/sogni-client/commit/7ee2311354071bbcc3087cad0a8c321cea28cd25))

# [4.0.0-alpha.15](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.14...v4.0.0-alpha.15) (2025-12-02)


### Bug Fixes

* Avoid double initialization for WSCoordinator.ts ([1b7e973](https://github.com/Sogni-AI/sogni-client/commit/1b7e973cebd6b35667fa248656127b60125dd4f9))

# [4.0.0-alpha.14](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.13...v4.0.0-alpha.14) (2025-12-01)


### Bug Fixes

* Move type definitions to dependencies from devDependencies ([95b5201](https://github.com/Sogni-AI/sogni-client/commit/95b520191593913bd0b74cd8cf41241eac16dd8e))

# [4.0.0-alpha.13](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.12...v4.0.0-alpha.13) (2025-12-01)


### Features

* When using cookies auth in browser environment allow sharing one socket connection between multiple tabs ([794d6e1](https://github.com/Sogni-AI/sogni-client/commit/794d6e18d960c8758094f09b2bc516b8b08175d0))

# [4.0.0-alpha.12](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.11...v4.0.0-alpha.12) (2025-10-30)


### Features

* Expose project cost in both Spark Points and Sogni tokens when estimating ([9d5f556](https://github.com/Sogni-AI/sogni-client/commit/9d5f556154013ae15e49e93e9941533e730502c5))

# [4.0.0-alpha.11](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.10...v4.0.0-alpha.11) (2025-10-23)


### Bug Fixes

* Accept raw samplers and schedulers for backward compatibility ([8c04552](https://github.com/Sogni-AI/sogni-client/commit/8c04552667fe054e9a330a3aab8fd776060a0ed6))

# [4.0.0-alpha.10](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.9...v4.0.0-alpha.10) (2025-10-21)


### Bug Fixes

* Fix project estimation. Export supported samplers and schedulers list ([502d4d1](https://github.com/Sogni-AI/sogni-client/commit/502d4d19529883b5272466a122720f2c6fd01e2e))

# [4.0.0-alpha.9](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.8...v4.0.0-alpha.9) (2025-10-17)


### Bug Fixes

* Hide samplers that are not well tested ([0522bed](https://github.com/Sogni-AI/sogni-client/commit/0522bed6cfad5f8bc9c37d65c30b63b31aa0168a))

# [4.0.0-alpha.8](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.7...v4.0.0-alpha.8) (2025-10-17)


### Bug Fixes

* Fix cost estimation call ([920981c](https://github.com/Sogni-AI/sogni-client/commit/920981c86a3b1217c8dc6437e0fcdc26f50fe4ec))

# [4.0.0-alpha.7](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.6...v4.0.0-alpha.7) (2025-10-17)


### Bug Fixes

* Update docs ([d486f44](https://github.com/Sogni-AI/sogni-client/commit/d486f448f3d55098449ba676dd77148c6a7104c4))

# [4.0.0-alpha.6](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.5...v4.0.0-alpha.6) (2025-10-17)


### Bug Fixes

* Update docs ([7f28fe7](https://github.com/Sogni-AI/sogni-client/commit/7f28fe7f651937f244a3b5f56a92aac5d3b637a5))

# [4.0.0-alpha.5](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.4...v4.0.0-alpha.5) (2025-10-17)


### Bug Fixes

* Code cleanup ([7b482dd](https://github.com/Sogni-AI/sogni-client/commit/7b482dd5c0667b3ad57e0fec75811f8bf5a14bee))

# [4.0.0-alpha.4](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.3...v4.0.0-alpha.4) (2025-10-17)


### Features

* Update schedulers and samplers options. ([7971cdc](https://github.com/Sogni-AI/sogni-client/commit/7971cdc7b1114840196fdada5adbf22cf867053e))


### BREAKING CHANGES

* `scheduler` and `timeStepSpacing` options renamed

 - `scheduler` option renamed to `sampler`
 - `timeStepSpacing` is now `scheduler`
 - Options are now referenced by short aliases

# [4.0.0-alpha.3](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.2...v4.0.0-alpha.3) (2025-10-02)


### Features

* Add rememberMe parameter for login and signup API to allow long lived cookie-based session ([e0c1395](https://github.com/Sogni-AI/sogni-client/commit/e0c13957c3ff8d548e40453f9c57d72390fdd9d7))

# [4.0.0-alpha.2](https://github.com/Sogni-AI/sogni-client/compare/v4.0.0-alpha.1...v4.0.0-alpha.2) (2025-09-30)


### Features

* Make logout synchronous. That is important for cookie auth ([5c39cd1](https://github.com/Sogni-AI/sogni-client/commit/5c39cd1589b25fe95eb77ace716f78d9933b303d))

# [4.0.0-alpha.1](https://github.com/Sogni-AI/sogni-client/compare/v3.4.0-alpha.1...v4.0.0-alpha.1) (2025-09-30)


### Features

* Add support for token and cookie authentication with updated AuthManager and REST client enhancements ([a5a2bd2](https://github.com/Sogni-AI/sogni-client/commit/a5a2bd2f005ea298e07773f0954b99ea2c43bc5d))


### BREAKING CHANGES

* Various changes in ApiClient, AuthManager and CurrentAccount.

Most notable:
1. `client.apiClient.authenticate` replaced with `client.setTokens`
2. Added `client.checkAuth` to check if client is authenticated when using cookie authentication
3. Added `authType` to `SogniClient.createInstance` to switch between token and cookie authentication
4. Removed `token` and `refreshToken` keys from `client.account.currentAccount`
5. Added `email` to `client.account.currentAccount`
6. Added `client.account.me()` method to refresh current account data

# [3.4.0-alpha.1](https://github.com/Sogni-AI/sogni-client/compare/v3.3.0...v3.4.0-alpha.1) (2025-09-15)


### Features

* include credentials in REST API wrapper ([5ccdbab](https://github.com/Sogni-AI/sogni-client/commit/5ccdbabd66f9ad6fb1cb07682c3b8975ceb45fca))

# [3.3.0](https://github.com/Sogni-AI/sogni-client/compare/v3.2.0...v3.3.0) (2025-08-26)


### Features

* Add context image support for Flux Kontext ([667c445](https://github.com/Sogni-AI/sogni-client/commit/667c44539288f78b01c7d15ff2a88bbd1f81b7bc))

# [3.2.0](https://github.com/Sogni-AI/sogni-client/compare/v3.1.1...v3.2.0) (2025-08-26)


### Features

* Expose new project option  png or jpg ([e3c1c8d](https://github.com/Sogni-AI/sogni-client/commit/e3c1c8d851779a8006e5b8e7023212bd65950297))

## [3.1.1](https://github.com/Sogni-AI/sogni-client/compare/v3.1.0...v3.1.1) (2025-08-14)


### Bug Fixes

* Add new schedulers and time step spacing values ([fe5e79e](https://github.com/Sogni-AI/sogni-client/commit/fe5e79eff117c9bfc4b9ef0afdaf4eb9eb759755))

# [3.1.0](https://github.com/Sogni-AI/sogni-client/compare/v3.0.1...v3.1.0) (2025-08-07)


### Features

* Expose `premiumCredit` Spark amount in account balance ([57e568c](https://github.com/Sogni-AI/sogni-client/commit/57e568cdff0bb29ce61489dab6280f735f497bb8))

## [3.0.1](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0...v3.0.1) (2025-07-15)


### Bug Fixes

* Bring back package-lock.json ([28d21e1](https://github.com/Sogni-AI/sogni-client/commit/28d21e192c15fca5b76254572d6fcbd1e8140b29))
* Update README.md ([3348834](https://github.com/Sogni-AI/sogni-client/commit/3348834163d438ce99c3dfa9d466649544e9b777))

# [3.0.0](https://github.com/Sogni-AI/sogni-client/compare/v2.0.4...v3.0.0) (2025-07-15)


### Bug Fixes

* Copy size preset when enhancing image ([06ab629](https://github.com/Sogni-AI/sogni-client/commit/06ab629a9b10377c87406817d1e72a0cd35bd025))
* Discard enhancement project before starting new one ([4293b2b](https://github.com/Sogni-AI/sogni-client/commit/4293b2b535ed8cfe76ce307de71c99bec799bd79))
* Do not mark project as completed if not all jobs started yet ([812e5ac](https://github.com/Sogni-AI/sogni-client/commit/812e5accd8605a6a742beb16a53bca2be50b9a81))
* Fix job.getResultUrl() bug ([ea90083](https://github.com/Sogni-AI/sogni-client/commit/ea900831cd578c5962236b70564cab0da4f2f7a8))
* Fix project sync attempt counter ([b112c06](https://github.com/Sogni-AI/sogni-client/commit/b112c064b443186b1992a80da5612af001919107))
* Pass tokenType to jobRequest message. Make tokenType optional for project estimation ([9550d76](https://github.com/Sogni-AI/sogni-client/commit/9550d76ee3d40fb4321a157d0a5feb0fb680f183))
* Prevent job progress going down ([5cf69d3](https://github.com/Sogni-AI/sogni-client/commit/5cf69d375d3a284964ba423c4287d592538cd273))
* Set scheduler and timeStepSpacing to null by default ([ccc1fc8](https://github.com/Sogni-AI/sogni-client/commit/ccc1fc842b408f905fd786807be5b5df8895690b))
* Update typings to indicate that `unclaimed` field may be absent from balance ([a661e17](https://github.com/Sogni-AI/sogni-client/commit/a661e17f549c3a51003557acb5e3ee5e34877f9d))


### Features

* Add `provider` parameter to `client.account.transactionHistory` ([9de208a](https://github.com/Sogni-AI/sogni-client/commit/9de208aa478d745a0706d8960e033e4cc9e25d35))
* Add basic ControlNet support ([220991d](https://github.com/Sogni-AI/sogni-client/commit/220991db5b16740b159d2cb0c3e746141fa4906f))
* Add job.getResultUrl() method to retrieve fresh download URL for a job ([82ce8d3](https://github.com/Sogni-AI/sogni-client/commit/82ce8d3cc9681800616185aac50e8f2102314ed4))
* Add new leaderboard types ([d6d3fb8](https://github.com/Sogni-AI/sogni-client/commit/d6d3fb8a7c5a84ff089d6b51bc448da26821174a))
* Add prompt and style overrides for image enhancer ([35cd4a0](https://github.com/Sogni-AI/sogni-client/commit/35cd4a017361f919d42a2568fff6e2e7b4367949))
* Add support for `authenticated` socket event ([bc3d345](https://github.com/Sogni-AI/sogni-client/commit/bc3d3451e7640eb15f1368144bbc112298f640fa))
* add support for receiving positivePrompt, negativePrompt, and jobIndex from jobInitiating and jobStarted events, these are useful for dynamic prompt result mapping ([d9873fa](https://github.com/Sogni-AI/sogni-client/commit/d9873fad77709afb72a02eb52ee5fd95e72244be))
* Add support for toast message events ([2b032a8](https://github.com/Sogni-AI/sogni-client/commit/2b032a83b3c28798a4df692c1cb6f090915191a6))
* add TokenType export and update LIB_VERSION from package.json ([f6110b5](https://github.com/Sogni-AI/sogni-client/commit/f6110b521715a076a7abb3010c68fbde8ea64b71))
* add tokenType to estimateCost and estimateEnhancementCost methods ([1c97258](https://github.com/Sogni-AI/sogni-client/commit/1c97258facb2ddd687361a5172d5318329a70c43))
* add tokenType to transaction list ([ee5951e](https://github.com/Sogni-AI/sogni-client/commit/ee5951ef9014ec6eed6a5b52acb5b8b1c5d1227d))
* Add turnstile token parameter to claimReward ([a96f5e2](https://github.com/Sogni-AI/sogni-client/commit/a96f5e2b22fd879a717aae1c3fe6f60ad675d031))
* Allow insecure socket connections ([5da2b0a](https://github.com/Sogni-AI/sogni-client/commit/5da2b0abb57e0e8ab7c7c5de449ea7a04183b753))
* Allow passing string to `account.deposit` and `account.withdraw` ([c9397f1](https://github.com/Sogni-AI/sogni-client/commit/c9397f1436b7c198ba4be860414815c6fc637bf6))
* Allow setting token type for image enhancement ([7420274](https://github.com/Sogni-AI/sogni-client/commit/7420274caf852b078d47e008b6065da70a456714))
* Bump PROTOCOL_VERSION ([6e5f6b9](https://github.com/Sogni-AI/sogni-client/commit/6e5f6b91870fbd557ce235d0508216c1b4e93cad))
* Cloudflare Turnstile token is required during signup ([768b9c8](https://github.com/Sogni-AI/sogni-client/commit/768b9c8a46f05f7b196976d3a7aa8a1e512ca172))
* Decouple fetching balance from the refresh method ([a7d4f62](https://github.com/Sogni-AI/sogni-client/commit/a7d4f625fc29831fdd72fda65af622d303ef1d32))
* Default client to mainnet ([5f9e44f](https://github.com/Sogni-AI/sogni-client/commit/5f9e44f462cd1b6f5bddc30e523567fa8b671736))
* Default rewards provider to `base`, add provider param to queried rewards ([d84dcff](https://github.com/Sogni-AI/sogni-client/commit/d84dcff1d3e01b7154e62724d078cfd158d12317))
* emit jobStarted, jobCompleted, and jobFailed events for better job tracking ([0e3bb33](https://github.com/Sogni-AI/sogni-client/commit/0e3bb33703868a3491edfac2c9f08325db0eb278))
* Expose getNonce method as public ([694c041](https://github.com/Sogni-AI/sogni-client/commit/694c041431b99c4bae2d5dc8f22d327fed45771d))
* Expose option to disable socket connection (Experimental) ([048adcf](https://github.com/Sogni-AI/sogni-client/commit/048adcfad99acd8ffb8197ad55f7d54679aacde8))
* Image enhancement with Flux model ([82488e7](https://github.com/Sogni-AI/sogni-client/commit/82488e7658b56902cee25e58bc1763c1392c5d46))
* Migrate account deposit to v3 ([71bfaac](https://github.com/Sogni-AI/sogni-client/commit/71bfaacca89c3a7f721b91ca39226650a2eb4ff5))
* Refactor image enhancement logic ([6728875](https://github.com/Sogni-AI/sogni-client/commit/67288759637c4b22266455ce1f1220d2590d7592))
* Remove blockchain provider since SDK does not need to call Base ([d5f8609](https://github.com/Sogni-AI/sogni-client/commit/d5f8609f29b9f9843913ecaf514516f490a60c61))
* Set project to error state if failed to sync it to server after not receiving any socket updates ([7ac63c4](https://github.com/Sogni-AI/sogni-client/commit/7ac63c40c5441578cc7beca4363a5301e6450fc3))
* Support for EIP712 on mainnet ([5e04e81](https://github.com/Sogni-AI/sogni-client/commit/5e04e8129f59bfac0ed6d65cc7c847ad622111b2))
* Support passing `provider` parameter when claiming reward ([71a045e](https://github.com/Sogni-AI/sogni-client/commit/71a045e60dbda63efe9f513bc9ffe8328f5e3dd2))
* Support rewards v4 API to query rewards scoped to ([ff0a713](https://github.com/Sogni-AI/sogni-client/commit/ff0a71387f602faba7da9a2e494f886a98881d95))
* Support uploading starting image and ControlNet input image before creating a project ([4fd8a5a](https://github.com/Sogni-AI/sogni-client/commit/4fd8a5a3597e7b3bb85c4a8c94cd2df798ca6bfe))
* update balance API and data format to support multiple token types. Support passing token type in Project request ([f227467](https://github.com/Sogni-AI/sogni-client/commit/f22746748f7da3df8dfd9f8fd0cb90a8f7269cac))


### BREAKING CHANGES

* `client.account.claimRewards` signature changed
* client.projects.estimateCost and client.projects.estimateEnhancementCost signature changed
* Balance data format has changed
* Signup signature is changed.Turnstile token is required for Signup

# [3.0.0-alpha.42](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.41...v3.0.0-alpha.42) (2025-07-15)


### Bug Fixes

* remove provider instance as it is not actually used ([62f384e](https://github.com/Sogni-AI/sogni-client/commit/62f384e82c4e5ae453bbec567ce58aa5ae1e7c72))
* update documentation ([5d09f39](https://github.com/Sogni-AI/sogni-client/commit/5d09f39181e058bd6d5706d8d919d7855bb6dd81))

# [3.0.0-alpha.41](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.40...v3.0.0-alpha.41) (2025-07-15)


### Features

* Allow passing string to `account.deposit` and `account.withdraw` ([c9397f1](https://github.com/Sogni-AI/sogni-client/commit/c9397f1436b7c198ba4be860414815c6fc637bf6))

# [3.0.0-alpha.40](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.39...v3.0.0-alpha.40) (2025-07-02)


### Features

* Default client to mainnet ([5f9e44f](https://github.com/Sogni-AI/sogni-client/commit/5f9e44f462cd1b6f5bddc30e523567fa8b671736))

# [3.0.0-alpha.39](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.38...v3.0.0-alpha.39) (2025-07-02)


### Features

* Support for EIP712 on mainnet ([5e04e81](https://github.com/Sogni-AI/sogni-client/commit/5e04e8129f59bfac0ed6d65cc7c847ad622111b2))

# [3.0.0-alpha.38](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.37...v3.0.0-alpha.38) (2025-06-30)


### Features

* Migrate account deposit to v3 ([71bfaac](https://github.com/Sogni-AI/sogni-client/commit/71bfaacca89c3a7f721b91ca39226650a2eb4ff5))

# [3.0.0-alpha.37](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.36...v3.0.0-alpha.37) (2025-06-29)


### Features

* Add support for `authenticated` socket event ([bc3d345](https://github.com/Sogni-AI/sogni-client/commit/bc3d3451e7640eb15f1368144bbc112298f640fa))

# [3.0.0-alpha.36](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.35...v3.0.0-alpha.36) (2025-06-29)


### Features

* Expose option to disable socket connection (Experimental) ([048adcf](https://github.com/Sogni-AI/sogni-client/commit/048adcfad99acd8ffb8197ad55f7d54679aacde8))

# [3.0.0-alpha.35](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.34...v3.0.0-alpha.35) (2025-06-25)


### Features

* Expose getNonce method as public ([694c041](https://github.com/Sogni-AI/sogni-client/commit/694c041431b99c4bae2d5dc8f22d327fed45771d))

# [3.0.0-alpha.34](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.33...v3.0.0-alpha.34) (2025-06-18)


### Features

* Decouple fetching balance from the refresh method ([a7d4f62](https://github.com/Sogni-AI/sogni-client/commit/a7d4f625fc29831fdd72fda65af622d303ef1d32))

# [3.0.0-alpha.33](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.32...v3.0.0-alpha.33) (2025-06-18)


### Bug Fixes

* Update typings to indicate that `unclaimed` field may be absent from balance ([a661e17](https://github.com/Sogni-AI/sogni-client/commit/a661e17f549c3a51003557acb5e3ee5e34877f9d))

# [3.0.0-alpha.32](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.31...v3.0.0-alpha.32) (2025-06-03)


### Features

* Add `provider` parameter to `client.account.transactionHistory` ([9de208a](https://github.com/Sogni-AI/sogni-client/commit/9de208aa478d745a0706d8960e033e4cc9e25d35))

# [3.0.0-alpha.31](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.30...v3.0.0-alpha.31) (2025-05-26)


### Features

* Default rewards provider to `base`, add provider param to queried rewards ([d84dcff](https://github.com/Sogni-AI/sogni-client/commit/d84dcff1d3e01b7154e62724d078cfd158d12317))

# [3.0.0-alpha.30](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.29...v3.0.0-alpha.30) (2025-05-26)


### Features

* Support passing `provider` parameter when claiming reward ([71a045e](https://github.com/Sogni-AI/sogni-client/commit/71a045e60dbda63efe9f513bc9ffe8328f5e3dd2))


### BREAKING CHANGES

* `client.account.claimRewards` signature changed

# [3.0.0-alpha.29](https://github.com/Sogni-AI/sogni-client/compare/v3.0.0-alpha.28...v3.0.0-alpha.29) (2025-05-26)


### Features

* Support rewards v4 API to query rewards scoped to ([ff0a713](https://github.com/Sogni-AI/sogni-client/commit/ff0a71387f602faba7da9a2e494f886a98881d95))

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

## [2.0.4](https://github.com/Sogni-AI/sogni-client/compare/v2.0.3...v2.0.4) (2025-05-14)


### Bug Fixes

* update documentation ([5d09f39](https://github.com/Sogni-AI/sogni-client/commit/5d09f39181e058bd6d5706d8d919d7855bb6dd81))

## [2.0.3](https://github.com/Sogni-AI/sogni-client/compare/v2.0.2...v2.0.3) (2025-05-14)


### Bug Fixes

* remove provider instance as it is not actually used ([62f384e](https://github.com/Sogni-AI/sogni-client/commit/62f384e82c4e5ae453bbec567ce58aa5ae1e7c72))

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
