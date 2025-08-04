# SystemJS Deobfuscator

This tool deobfuscates SystemJS packed JavaScript files by extracting `System.Register` calls and creating separate files for each module.

## Features

- Parses obfuscated JavaScript files using Babel parser
- Finds all `System.Register` calls automatically
- Extracts file names from any path format (e.g., `chunk:\\Folder\\File.ts`, `src/components/Button.tsx`, `./utils/helper.js`)
- **Handles special characters**: Sanitizes file names and method names while preserving original paths
- Creates separate JavaScript files for each module (always with `.js` extension)
- Wraps each module in a named function (e.g., `RegisterPlayer`)
- Replaces original calls with method calls
- Adds appropriate require statements

## Special Character Handling

The tool automatically sanitizes special characters in file names and method names:

- `chunks:///_virtual/ComponentCurseEffectiveRogueSkillList%20.ts` → `ComponentCurseEffectiveRogueSkillList_20.js` → `RegisterComponentCurseEffectiveRogueSkillList_20()`
- `chunks:///_virtual/util.mjs_cjs=&original=.js` → `util_mjs_cjs_original.js` → `RegisterUtil_mjs_cjs_original()`
- `File Name With Spaces.ts` → `File_Name_With_Spaces.js` → `RegisterFile_Name_With_Spaces()`

Original paths are preserved in the `System.register` calls and comments.

## Usage

```bash
npm install
node index.js <path/to/input.js>
```

Where `<path/to/input.js>` is the path to your obfuscated SystemJS file (e.g., `game.js`, `app.js`, etc.).

## Example

```bash
node index.js ./dist/game.js
node index.js /path/to/project/obfuscated.js
```

## Example

Given an obfuscated input file with:

```javascript
System.register("chunk:\\SomeFolder\\Player.ts", [], function(exports, module) {
    // Player implementation
});

System.register("src/components/GameEngine.tsx", [], function(exports, module) {
    // GameEngine implementation
});

System.register("SimpleFile.js", [], function(exports, module) {
    // Simple implementation
});
```

The tool will:

1. Create `Player.js` with a `RegisterPlayer()` function
2. Create `GameEngine.js` with a `RegisterGameEngine()` function  
3. Create `SimpleFile.js` with a `RegisterSimpleFile()` function
4. Generate `input_modified.js` with:
   ```javascript
   const { RegisterPlayer } = require('./Player.js');
   const { RegisterGameEngine } = require('./GameEngine.js');
   const { RegisterSimpleFile } = require('./SimpleFile.js');

   RegisterPlayer();
   RegisterGameEngine();
   RegisterSimpleFile();
   ```

## Output

- Individual module files (always `.js` files for Node.js compatibility)
- Modified main file (`<originalname>_modified.js`)
- Console summary of processed files

## Dependencies

- `@babel/parser` - For parsing JavaScript AST
- Node.js built-in modules: `fs`, `path`
