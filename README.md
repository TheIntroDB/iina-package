# TheIntroDB IINA Package

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

License: GPLv3