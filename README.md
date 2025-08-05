# SystemJS Deobfuscator

This tool deobfuscates SystemJS packed JavaScript files by extracting `System.Register` calls and creating separate files for each module.

## Features

- Parses obfuscated JavaScript files using Babel parser
- Finds all `System.Register` calls automatically
- Extracts file names from any path format (e.g., `chunk:\\Folder\\File.ts`, `src/components/Button.tsx`, `./utils/helper.js`)
- **Handles special characters**: Sanitizes file names and method names while preserving original paths
- **Evaluates constant conditions**: Automatically evaluates and replaces `if` conditions that use only constants and locally defined Math functions
- **Deobfuscates array-based control flow**: Detects and reorders switch statements that use manipulated arrays to obscure execution order
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

## Constant Condition Evaluation

The tool automatically detects and evaluates `if` conditions that use only:
- Local variables assigned to constants or Math functions
- Literal values (numbers, strings)
- Math operations and function calls

### Examples:

```javascript
// Before
function obfuscated() {
    var a = Math.log;
    var x = 5;
    var y = 10;
    
    if (x + y > 12) {
        console.log("condition A");
    }
    
    if (a(100) > a(50)) {
        console.log("condition B");
    }
}

// After
function obfuscated() {
    var a = Math.log;
    var x = 5;
    var y = 10;
    
    if (true) {
        console.log("condition A");
    }
    
    if (true) {
        console.log("condition B");
    }
}
```

This helps reveal the actual control flow in obfuscated code by removing constant condition obfuscation.

## Array-Based Control Flow Deobfuscation

The tool automatically detects and reorders switch statements that use array manipulation to obscure execution order:

### Example:

```javascript
// Before (obfuscated)
function swap(arr, i, j) { /* swap elements */ }

var order = [2, 0, 1, 3];
swap(order, 0, 3);  // [3, 0, 1, 2]

for (let i of order) {
    switch (i) {
        case 0: createObject(); break;
        case 1: setupProperties(); break;
        case 2: finalizeObject(); break;
        case 3: initializeData(); break;
    }
}

// After (deobfuscated)
// Execution order: [3, 0, 1, 2]
{
    // Step 1: Case 3
    initializeData();
    
    // Step 2: Case 0
    createObject();
    
    // Step 3: Case 1
    setupProperties();
    
    // Step 4: Case 2
    finalizeObject();
}
```

This reveals the true execution order hidden behind array manipulations and switch statements.

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
