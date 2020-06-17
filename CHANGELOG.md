# Change Log /  Release Notes
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [2.2.2] - 2020-06-16
## Fixed
- Use correct NPM OTP

## [2.2.1] - 2020-06-16
## Fixed
- Use correct Travis credentials

## [2.2.0] - 2020-06-16
## Added
- Typescript declaration

## [2.0.1] - 2019-06-20
## Fixed
- Use Client ctor `token` option

## [2.0.0] - 2018-12-19
## Added
- Support for STS Authentication
- JSDocs
## Removed
- Support for less than Node 8
- All logic relating to KMS authentication
- All logic that read user credentials from a TTY terminal

## [1.6.0] - 2018-07-16
## Added
- Support for File API from @mayitbeegh

## [1.5.2] - 2018-06-18
## Fixed
- Removed sensitive log info

## [1.5.1] - 2018-06-15
## Fixed
- Resolved issue with missing credentials in ECS

## [1.5.0] - 2018-06-08
## Added
- AWS ECS support

## [1.4.0] - 2018-06-04
## Added
- Authentication with assume role

## [1.3.0] - 2017-10-18
## Changed
- Use Cerberus v2 IAM principal auth. The previous version (v1) is deprecated.

## [1.1.2] - 2017-06-14
## Fixed
Error log from getting lambda configuruation

## [1.1.1] - 2017-06-14
## Added
Additional error guard to KMS

## [1.1.0] - 2017-06-07
## Added
Cerberus client header
## Changed
Coverage tool to Istanbul

## [1.0.0] - 2017-05-19
## Changed
- Required node version to v4.x
- Using promises internally
## Removed
- AWS SDK dependency

## [0.3.3] - 2017-05-08
### Changed
- Increase token expiration padding from 10 to 60 seconds

## [0.3.2] - 2017-05-03
### Changed
- Log key result after error check

## [0.3.1] - 2017-04-05
### Fixed
- `setLambdaContext` bug introduced in 0.3.0

## [0.3.0] - 2017-04-05
### Added
- MFA Support for prompt login

## [0.2.5] - 2017-03-31
### Changed
- Check for Cerberus errors before checking status code

## [0.2.4] - 2017-03-31
### Added
- Check for non-200 status from Cerberus Key Request

## [0.2.3] - 2017-03-31
### Added
- Return error from Cerberus for auth calls
- Tests for empty and error cerberus response

## [0.2.2] - 2017-03-06
### Fixed
- Token expiration logic

## [0.2.1] - 2017-01-06
### Changed
- Error check for cerberus server response

## [0.2.0] - 2016-11-15
### Added
- Code coverage npm script
- CHANGELOG.md
- CONTRIBUTING.md
- LICENSE.md
- User credentials (env and prompt) flow

### Changed
- Moved `test`
- split npm `test` script to into `style`, `unit`.
- Updated npm `test` script to wrap `style`, `unit`, and new `coverage` script
- Use Apache 2.0 License
- Start versioning at 0.2.0 to represent minor increase from pre-OSS version
- Added Tim Kye as maintainer in README
