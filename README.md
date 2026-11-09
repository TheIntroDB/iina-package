<img align="right" width="88" src="https://raw.githubusercontent.com/TheIntroDB/.github/main/integrations/iina.png" alt="IINA">

[![IINA macOS](https://img.shields.io/badge/IINA-macOS-000000?style=flat-square&logo=apple&logoColor=4ade80&labelColor=0d0d0d)](https://iina.io)
[![License](https://img.shields.io/github/license/TheIntroDB/iina-package?style=flat-square&logo=gnu&logoColor=4ade80&label=License&labelColor=0d0d0d&color=038939)](https://github.com/TheIntroDB/iina-package/blob/main/LICENSE)

[![Stars](https://img.shields.io/github/stars/TheIntroDB/iina-package?style=flat-square&logo=github&logoColor=4ade80&label=Stars&labelColor=0d0d0d&color=038939)](https://github.com/TheIntroDB/iina-package/stargazers)
[![Issues](https://img.shields.io/github/issues/TheIntroDB/iina-package?style=flat-square&logo=github&logoColor=4ade80&label=Issues&labelColor=0d0d0d&color=038939)](https://github.com/TheIntroDB/iina-package/issues)
[![Last commit](https://img.shields.io/github/last-commit/TheIntroDB/iina-package?style=flat-square&logo=git&logoColor=4ade80&label=Last%20commit&labelColor=0d0d0d&color=038939)](https://github.com/TheIntroDB/iina-package/commits)
[![Discord](https://img.shields.io/discord/1457550295742812307?style=flat-square&logo=discord&logoColor=4ade80&label=Discord&labelColor=0d0d0d&color=038939)](https://discord.com/channels/1457550295742812307/1457550298255200380)

### TheIntroDB – IINA Package

---

Skip intro, recap, credits, and preview segments with TheIntroDB in IINA for MacOS

## Installation
Open IINA settings, click Plugins -> Install From GitHub -> Then add `https://github.com/TheIntroDB/iina-package` and install the package!

## Development

`dist/` is committed and is what IINA installs, so a change is not shipped
until the bundles are rebuilt:

```sh
pnpm install --frozen-lockfile
pnpm build     # rm -rf dist && parcel build .
pnpm verify    # the bundles carry the endpoint src/tidb.js names
```


## License

**GNU General Public License v3.0 or later** (`GPL-3.0-or-later`) — see [LICENSE](LICENSE) for the full text.

> This program is free software: you can redistribute it and/or modify it under the
> terms of the GNU General Public License as published by the Free Software
> Foundation, either version 3 of the License, or (at your option) any later version.
>
> This program is distributed in the hope that it will be useful, but WITHOUT ANY
> WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
> PARTICULAR PURPOSE. See the GNU General Public License for more details.

Every source file carries `SPDX-License-Identifier: GPL-3.0-or-later`. The "or later" grant is deliberate: it lets the project adopt a future GPL version without re-licensing from every contributor.

---

--

<p align="center">
  <a href="https://theintrodb.org"><img src="https://raw.githubusercontent.com/TheIntroDB/theintrodb-assets/main/badge.png" alt="TheIntroDB" width="44" height="44"></a>
  <br><br>
  <sub><b>TheIntroDB</b> · community-submitted intro, recap, credits and preview timestamps for your media server<br>
  <a href="https://theintrodb.org">theintrodb.org</a> · <a href="https://github.com/TheIntroDB">GitHub</a> · <a href="https://discord.com/channels/1457550295742812307/1457550298255200380">Discord</a></sub>
</p>
