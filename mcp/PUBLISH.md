# Publishing @cstan0824/remembry-mcp

## Prerequisites

- npm account with access to `@cstan0824` scope
- Login: `npm login`

## Steps

1. **Ensure version is correct** in `package.json`:

   ```bash
   cd mcp
   cat package.json | grep version
   ```

2. **Build the project**:

   ```bash
   npm run build
   ```

3. **Test locally** (optional):

   ```bash
   npm pack
   # Inspect the tarball contents
   ```

4. **Publish to npm**:

   ```bash
   npm publish --access public
   ```

5. **Verify**:

   ```bash
   npm view @cstan0824/remembry-mcp version
   ```

## Version Bump

To publish a new version:

```bash
# Update version in package.json
npm version patch   # 0.3.2 -> 0.3.3
npm version minor   # 0.3.2 -> 0.4.0
npm version major   # 0.3.2 -> 1.0.0

# Then publish
npm publish --access public
```

## Troubleshooting

- **ENEEDAUTH**: Run `npm login` first
- **403 Forbidden**: Ensure your npm token has publish permissions for the `@cstan0824` scope
- **Version already exists**: Bump the version before publishing
