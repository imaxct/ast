const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

// Get input file path from command line argument
const inputFilePath = process.argv[2];

if (!inputFilePath) {
    console.error('Please provide the path to the input JavaScript file');
    console.error('Usage: node index.js <path/to/input.js>');
    process.exit(1);
}

if (!fs.existsSync(inputFilePath)) {
    console.error(`Input file does not exist: ${inputFilePath}`);
    process.exit(1);
}

const workingDirectory = path.dirname(inputFilePath);
const inputFileName = path.basename(inputFilePath);

console.log(`Processing ${inputFileName} in: ${workingDirectory}`);

// Read the obfuscated input file
let gameJsContent = fs.readFileSync(inputFilePath, 'utf8');

// Parse the JavaScript using Babel parser
let ast;
try {
    ast = parser.parse(gameJsContent, {
        sourceType: 'script',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: []
    });
} catch (error) {
    console.error(`Error parsing ${inputFileName}:`, error.message);
    process.exit(1);
}

// Function to traverse AST and find System.Register calls
function findSystemRegisterCalls(node) {
    const systemRegisterCalls = [];
    
    function traverse(node) {
        if (!node || typeof node !== 'object') return;
        
        // Check if this is a System.Register call
        if (node.type === 'CallExpression' && 
            node.callee && 
            node.callee.type === 'MemberExpression' &&
            node.callee.object && 
            node.callee.object.name === 'System' &&
            node.callee.property && 
            node.callee.property.name === 'register') {
            
            systemRegisterCalls.push(node);
        }
        
        // Recursively traverse all properties
        for (const key in node) {
            if (node.hasOwnProperty(key) && node[key] && typeof node[key] === 'object') {
                if (Array.isArray(node[key])) {
                    node[key].forEach(traverse);
                } else {
                    traverse(node[key]);
                }
            }
        }
    }
    
    traverse(node);
    return systemRegisterCalls;
}

// Function to extract the original code for a System.Register call
function extractOriginalCode(content, startPos, endPos) {
    return content.substring(startPos, endPos);
}

// Function to extract file name from any path format
function extractFileName(pathString) {
    // Handle different path formats and extract just the filename
    // Examples:
    // "chunk:\\SomeFolder\\FileName.ts" -> "FileName.ts"
    // "chunks:///_virtual/util.mjs_cjs=&original=.js" -> "util.mjs_cjs=&original=.js"
    // "chunks:///_virtual/ComponentCurseEffectiveRogueSkillList%20.ts" -> "ComponentCurseEffectiveRogueSkillList%20.ts"
    // "./utils/helper.js" -> "helper.js"
    // "FileName.ts" -> "FileName.ts"
    
    // Remove any quotes if present
    let cleanPath = pathString.replace(/['"]/g, '');
    
    // Split by various separators and get the last part
    const separators = ['\\', '/', ':'];
    let fileName = cleanPath;
    
    for (const separator of separators) {
        const parts = fileName.split(separator);
        fileName = parts[parts.length - 1];
    }
    
    // Clean up any remaining special characters at the start
    fileName = fileName.replace(/^[^a-zA-Z0-9_.-]+/, '');
    
    return fileName || null;
}

// Function to sanitize file name for file system
function sanitizeFileName(fileName) {
    if (!fileName) return null;
    
    // Get the file extension first
    const lastDotIndex = fileName.lastIndexOf('.');
    let baseName = fileName;
    let extension = '';
    
    if (lastDotIndex > 0) {
        baseName = fileName.substring(0, lastDotIndex);
        extension = fileName.substring(lastDotIndex);
    }
    
    // Remove or replace invalid file name characters
    // Keep only letters, numbers, underscore, hyphen
    baseName = baseName.replace(/[%\s=&<>:"/\\|?*]/g, '_')
                     .replace(/[^\w\s-]/g, '_')
                     .replace(/_{2,}/g, '_')
                     .replace(/^_+|_+$/g, '');
    
    // Ensure it starts with a letter or underscore
    if (!/^[a-zA-Z_]/.test(baseName)) {
        baseName = '_' + baseName;
    }
    
    return baseName + extension;
}

// Function to create method name from file name
function createMethodName(fileName) {
    // Remove extension and convert to camelCase
    const baseName = path.parse(fileName).name;
    
    // Sanitize the base name for JavaScript identifier
    // Remove or replace invalid JavaScript identifier characters
    let sanitizedName = baseName.replace(/[%\s=&<>:"/\\|?*]/g, '_')
                                .replace(/[^\w]/g, '_')
                                .replace(/_{2,}/g, '_')
                                .replace(/^_+|_+$/g, '');
    
    // Ensure it starts with a letter or underscore
    if (!/^[a-zA-Z_]/.test(sanitizedName)) {
        sanitizedName = '_' + sanitizedName;
    }
    
    // Convert to PascalCase and prefix with "Register"
    const methodName = 'Register' + sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1);
    return methodName;
}

// Function to evaluate constant conditions in if statements
function evaluateConstantConditions(ast, content) {
    const evaluatedConditions = [];
    let modifiedContent = content;
    
    function traverse(node, scope = new Map()) {
        if (!node || typeof node !== 'object') return;
        
        // Track variable declarations in current scope
        if (node.type === 'VariableDeclaration') {
            node.declarations.forEach(declaration => {
                if (declaration.init && declaration.id && declaration.id.name) {
                    // Track simple assignments like: var a = Math.log;
                    if (declaration.init.type === 'MemberExpression') {
                        const objName = declaration.init.object.name;
                        const propName = declaration.init.property.name;
                        if (objName === 'Math') {
                            scope.set(declaration.id.name, `Math.${propName}`);
                        }
                    }
                    // Track literal assignments
                    else if (declaration.init.type === 'Literal' || declaration.init.type === 'NumericLiteral' || declaration.init.type === 'StringLiteral') {
                        scope.set(declaration.id.name, declaration.init.value);
                    }
                }
            });
        }
        
        // Process if statements
        if (node.type === 'IfStatement' && node.test) {
            const condition = evaluateConditionExpression(node.test, scope);
            if (condition !== null) {
                evaluatedConditions.push({
                    node: node,
                    originalCondition: content.substring(node.test.start, node.test.end),
                    evaluatedValue: condition,
                    start: node.test.start,
                    end: node.test.end
                });
            }
        }
        
        // Recursively traverse all properties
        for (const key in node) {
            if (node.hasOwnProperty(key) && node[key] && typeof node[key] === 'object') {
                if (Array.isArray(node[key])) {
                    node[key].forEach(child => traverse(child, scope));
                } else {
                    traverse(node[key], scope);
                }
            }
        }
    }
    
    traverse(ast);
    
    // Apply the evaluated conditions (in reverse order to maintain positions)
    evaluatedConditions.sort((a, b) => b.start - a.start);
    
    evaluatedConditions.forEach(condition => {
        const before = modifiedContent.substring(0, condition.start);
        const after = modifiedContent.substring(condition.end);
        const newCondition = condition.evaluatedValue.toString();
        
        modifiedContent = before + newCondition + after;
        console.log(`Replaced condition: ${condition.originalCondition} → ${newCondition}`);
    });
    
    return modifiedContent;
}

// Function to deobfuscate array-based control flow
function deobfuscateArrayControlFlow(ast, originalContent) {
    let modifiedContent = originalContent;
    const replacements = [];
    
    function traverse(node, scope = new Map()) {
        if (!node || typeof node !== 'object') return;
        
        // Track variable declarations (arrays and functions)
        if (node.type === 'VariableDeclaration') {
            node.declarations.forEach(declaration => {
                if (declaration.init && declaration.id && declaration.id.name) {
                    if (declaration.init.type === 'ArrayExpression') {
                        // Track array initialization
                        const arrayValues = declaration.init.elements.map(el => 
                            el && (el.type === 'NumericLiteral' || el.type === 'Literal') ? el.value : null
                        );
                        if (arrayValues.every(v => v !== null)) {
                            scope.set(declaration.id.name, { type: 'array', value: [...arrayValues] });
                        }
                    }
                }
            });
        }
        
        // Track function declarations that manipulate arrays
        if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
            // Look for simple swap functions like l8p(a, b, c)
            if (node.params && node.params.length === 3 && node.body && node.body.body) {
                const isSwapFunction = isArraySwapFunction(node.body.body);
                if (isSwapFunction) {
                    scope.set(node.id.name, { type: 'swap_function' });
                }
            }
        }
        
        // Track function calls that manipulate arrays
        if (node.type === 'CallExpression' && node.callee && node.callee.name) {
            const funcName = node.callee.name;
            if (scope.has(funcName) && scope.get(funcName).type === 'swap_function') {
                // This is a call to our swap function
                if (node.arguments.length === 3) {
                    const arrayName = node.arguments[0].name;
                    const index1 = getConstantValue(node.arguments[1], scope);
                    const index2 = getConstantValue(node.arguments[2], scope);
                    
                    if (arrayName && index1 !== null && index2 !== null && scope.has(arrayName)) {
                        const arrayData = scope.get(arrayName);
                        if (arrayData.type === 'array') {
                            // Perform the swap
                            const temp = arrayData.value[index1];
                            arrayData.value[index1] = arrayData.value[index2];
                            arrayData.value[index2] = temp;
                        }
                    }
                }
            }
        }
        
        // Look for for-of loops with switch statements
        if (node.type === 'ForOfStatement' && node.right && node.right.name && node.body) {
            const arrayName = node.right.name;
            if (scope.has(arrayName) && scope.get(arrayName).type === 'array') {
                const finalArray = scope.get(arrayName).value;
                const switchStatement = findSwitchInBlock(node.body);
                
                if (switchStatement) {
                    const reorderedStatements = reorderSwitchCases(switchStatement, finalArray, originalContent);
                    if (reorderedStatements) {
                        replacements.push({
                            start: node.start,
                            end: node.end,
                            replacement: `// Original for-of loop replaced with deobfuscated execution order\n        ${reorderedStatements}`,
                            originalArray: arrayName,
                            finalOrder: finalArray
                        });
                    }
                }
            }
        }
        
        // Recursively traverse
        for (const key in node) {
            if (node.hasOwnProperty(key) && node[key] && typeof node[key] === 'object') {
                if (Array.isArray(node[key])) {
                    node[key].forEach(child => traverse(child, scope));
                } else {
                    traverse(node[key], scope);
                }
            }
        }
    }
    
    traverse(ast);
    
    // Apply replacements in reverse order
    replacements.sort((a, b) => b.start - a.start);
    
    replacements.forEach(replacement => {
        const before = modifiedContent.substring(0, replacement.start);
        const after = modifiedContent.substring(replacement.end);
        
        modifiedContent = before + replacement.replacement + after;
        console.log(`Reordered switch based on array ${replacement.originalArray}: [${replacement.finalOrder.join(', ')}]`);
    });
    
    return modifiedContent;
}

// Check if a function body represents an array swap function
function isArraySwapFunction(statements) {
    if (statements.length < 3) return false;
    
    // Look for pattern: let d = a[b]; a[b] = a[c]; a[c] = d;
    const hasTemp = statements.some(stmt => 
        stmt.type === 'VariableDeclaration' && 
        stmt.declarations.some(decl => 
            decl.init && decl.init.type === 'MemberExpression'
        )
    );
    
    const hasAssignments = statements.filter(stmt => 
        stmt.type === 'ExpressionStatement' && 
        stmt.expression && stmt.expression.type === 'AssignmentExpression' &&
        stmt.expression.left && stmt.expression.left.type === 'MemberExpression'
    ).length >= 2;
    
    return hasTemp && hasAssignments;
}

// Get constant value from a node
function getConstantValue(node, scope) {
    if (!node) return null;
    
    if (node.type === 'NumericLiteral' || node.type === 'Literal') {
        return node.value;
    }
    
    if (node.type === 'Identifier' && scope.has(node.name)) {
        const data = scope.get(node.name);
        return data.type === 'constant' ? data.value : null;
    }
    
    return null;
}

// Find switch statement in a block
function findSwitchInBlock(node) {
    if (node.type === 'SwitchStatement') return node;
    
    if (node.type === 'BlockStatement' && node.body) {
        for (const stmt of node.body) {
            if (stmt.type === 'SwitchStatement') return stmt;
            const found = findSwitchInBlock(stmt);
            if (found) return found;
        }
    }
    
    return null;
}

// Reorder switch cases based on array order
function reorderSwitchCases(switchNode, arrayOrder, originalContent) {
    if (!switchNode.cases) return null;
    
    // Debug: log the switch structure
    console.log('Switch cases found:', switchNode.cases.length);
    
    // Create a map of case value to case node
    const caseMap = new Map();
    let defaultCase = null;
    
    switchNode.cases.forEach((caseNode, caseIndex) => {
        console.log(`Case ${caseIndex}:`, caseNode.test ? caseNode.test.value : 'default', 'statements:', caseNode.consequent.length);
        
        if (caseNode.test === null) {
            defaultCase = caseNode;
        } else if (caseNode.test.type === 'NumericLiteral' || caseNode.test.type === 'Literal') {
            caseMap.set(caseNode.test.value, caseNode);
            
            // Debug each statement in this case
            caseNode.consequent.forEach((stmt, stmtIndex) => {
                const stmtText = originalContent.substring(stmt.start, stmt.end).trim();
                console.log(`  Statement ${stmtIndex}: ${stmt.type} = "${stmtText.substring(0, 50)}..."`);
            });
        }
    });
    
    // Generate reordered statements
    let reorderedCode = '// Deobfuscated switch - execution order: [' + arrayOrder.join(', ') + ']\n';
    
    arrayOrder.forEach((value, index) => {
        if (caseMap.has(value)) {
            const caseNode = caseMap.get(value);
            const statements = caseNode.consequent || [];
            
            reorderedCode += `// Step ${index + 1}: Case ${value}\n`;
            
            // Process each statement in the case
            statements.forEach((stmt, i) => {
                // Skip break statements that are at the end of a case
                if (stmt.type === 'BreakStatement' && i === statements.length - 1) {
                    return; // Skip trailing breaks
                }
                
                // Extract the source code for this specific statement
                if (stmt.start && stmt.end) {
                    let sourceCode = originalContent.substring(stmt.start, stmt.end).trim();
                    
                    // Add the statement to our output
                    reorderedCode += sourceCode + '\n';
                }
            });
            
            if (index < arrayOrder.length - 1) {
                reorderedCode += '\n';
            }
        }
    });
    
    return reorderedCode;
}

// Extract source code for a statement from the original content
function extractSourceCode(node, originalContent) {
    if (!node.start || !node.end) return '// Could not extract source';
    
    let sourceCode = originalContent.substring(node.start, node.end).trim();
    
    // Debug: log what we're extracting
    console.log(`Extracting ${node.type}: "${sourceCode.substring(0, 50)}..."`);
    
    // For incomplete extractions, try to find the complete statement
    if (node.type === 'ExpressionStatement' && sourceCode && !sourceCode.includes('=')) {
        // The extraction might be incomplete, try the full node range
        sourceCode = originalContent.substring(node.start, node.end).trim();
    }
    
    // Clean up and format the extracted code
    if (!sourceCode.endsWith(';') && !sourceCode.endsWith('}') && 
        node.type !== 'BreakStatement' && node.type !== 'ReturnStatement' &&
        node.type !== 'BlockStatement') {
        sourceCode += ';';
    }
    
    return sourceCode;
}

// Function to evaluate a condition expression if it contains only constants
function evaluateConditionExpression(node, scope) {
    try {
        const expression = buildExpression(node, scope);
        if (expression === null) return null;
        
        // Only evaluate if expression contains no undefined variables
        const result = Function(`"use strict"; return (${expression})`)();
        return typeof result === 'boolean' ? result : (typeof result === 'number' ? result > 0 : null);
    } catch (error) {
        return null; // If evaluation fails, don't replace
    }
}

// Function to build expression string from AST node
function buildExpression(node, scope) {
    if (!node) return null;
    
    switch (node.type) {
        case 'Literal':
        case 'NumericLiteral':
        case 'StringLiteral':
            return typeof node.value === 'string' ? `"${node.value}"` : String(node.value);
            
        case 'Identifier':
            if (scope.has(node.name)) {
                const value = scope.get(node.name);
                return typeof value === 'string' && value.startsWith('Math.') ? value : JSON.stringify(value);
            }
            return null; // Unknown identifier
            
        case 'BinaryExpression':
            const left = buildExpression(node.left, scope);
            const right = buildExpression(node.right, scope);
            if (left === null || right === null) return null;
            return `(${left} ${node.operator} ${right})`;
            
        case 'CallExpression':
            if (node.callee.type === 'Identifier' && scope.has(node.callee.name)) {
                const funcName = scope.get(node.callee.name);
                if (typeof funcName === 'string' && funcName.startsWith('Math.')) {
                    const args = node.arguments.map(arg => buildExpression(arg, scope));
                    if (args.some(arg => arg === null)) return null;
                    return `${funcName}(${args.join(', ')})`;
                }
            }
            return null;
            
        case 'UnaryExpression':
            const argument = buildExpression(node.argument, scope);
            if (argument === null) return null;
            return `${node.operator}${argument}`;
            
        default:
            return null;
    }
}

// Find all System.Register calls
const systemRegisterCalls = findSystemRegisterCalls(ast);
console.log(`Found ${systemRegisterCalls.length} System.Register calls`);

// Store original content for AST position references
const originalGameJsContent = gameJsContent;

// Process constant condition evaluation
console.log('Processing constant conditions...');
const constantEvaluatedContent = evaluateConstantConditions(ast, gameJsContent);
console.log('Constant condition evaluation completed');

// Process array-based control flow obfuscation (use original content for AST positions)
console.log('Processing array-based control flow...');
const arrayDeobfuscatedContent = deobfuscateArrayControlFlow(ast, originalGameJsContent);
console.log('Array control flow deobfuscation completed');

// If both transformations happened, we need to apply the constant evaluations to the array-transformed content
if (constantEvaluatedContent !== gameJsContent && arrayDeobfuscatedContent !== originalGameJsContent) {
    // Re-parse and apply constant conditions to the array-deobfuscated content
    let finalContent = arrayDeobfuscatedContent;
    try {
        const newAst = parser.parse(arrayDeobfuscatedContent, {
            sourceType: 'script',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            plugins: []
        });
        finalContent = evaluateConstantConditions(newAst, arrayDeobfuscatedContent);
        gameJsContent = finalContent;
    } catch (error) {
        console.log('Could not re-apply constant evaluation to array-deobfuscated content, using array result only');
        gameJsContent = arrayDeobfuscatedContent;
    }
} else if (constantEvaluatedContent !== gameJsContent) {
    // Only constant evaluation happened
    gameJsContent = constantEvaluatedContent;
} else if (arrayDeobfuscatedContent !== originalGameJsContent) {
    // Only array deobfuscation happened
    gameJsContent = arrayDeobfuscatedContent;
}

const createdFiles = [];
const methodReplacements = [];

// Process each System.Register call
systemRegisterCalls.forEach((call, index) => {
    if (!call.arguments || call.arguments.length < 1) {
        console.log(`Skipping call ${index + 1}: No arguments found`);
        return;
    }
    
    const firstArg = call.arguments[0];
    
    let chunkPath;
    if (firstArg.type === 'Literal') {
        chunkPath = firstArg.value;
    } else if (firstArg.type === 'StringLiteral') {
        chunkPath = firstArg.value;
    } else {
        console.log(`Skipping call ${index + 1}: First argument is not a string literal (type: ${firstArg.type})`);
        return;
    }
    
    if (typeof chunkPath !== 'string') {
        console.log(`Skipping call ${index + 1}: First argument is not a string`);
        return;
    }
    
    const fileName = extractFileName(chunkPath);
    
    if (!fileName) {
        console.log(`Skipping call ${index + 1}: Could not extract file name from "${chunkPath}"`);
        return;
    }
    
    // Sanitize the file name for file system
    const sanitizedFileName = sanitizeFileName(fileName);
    
    if (!sanitizedFileName) {
        console.log(`Skipping call ${index + 1}: Could not sanitize file name "${fileName}"`);
        return;
    }
    
    console.log(`Processing: ${chunkPath} -> ${fileName} -> ${sanitizedFileName}`);
    
    // Extract the original System.Register call code
    const originalCode = extractOriginalCode(gameJsContent, call.start, call.end);
    
    // Create method name (sanitized)
    const methodName = createMethodName(sanitizedFileName);
    
    // Create the new file content
    const newFileContent = `// Generated from ${chunkPath}
function ${methodName}() {
    ${originalCode}
}

module.exports = { ${methodName} };
`;
    
    // Always create .js files for Node.js compatibility
    const baseName = path.parse(sanitizedFileName).name;
    const jsFileName = `${baseName}.js`;
    const newFilePath = path.join(workingDirectory, jsFileName);
    fs.writeFileSync(newFilePath, newFileContent);
    
    createdFiles.push({
        fileName: jsFileName,
        filePath: newFilePath,
        methodName,
        originalCall: call
    });
    
    methodReplacements.push({
        start: call.start,
        end: call.end,
        replacement: `${methodName}()`
    });
    
    console.log(`Created: ${newFilePath} with method ${methodName}()`);
});

// Sort replacements by start position in reverse order to avoid position shifts
methodReplacements.sort((a, b) => b.start - a.start);

// Apply replacements to game.js content
let modifiedGameJs = gameJsContent;

methodReplacements.forEach(replacement => {
    modifiedGameJs = 
        modifiedGameJs.substring(0, replacement.start) + 
        replacement.replacement + 
        modifiedGameJs.substring(replacement.end);
});

// Add require statements at the top for all created files
const requireStatements = createdFiles.map(file => 
    `const { ${file.methodName} } = require('./${file.fileName}');`
).join('\n');

if (requireStatements) {
    modifiedGameJs = requireStatements + '\n\n' + modifiedGameJs;
}

// Write the modified file
const baseName = path.parse(inputFileName).name;
const extension = path.parse(inputFileName).ext;
const modifiedFileName = `${baseName}_modified${extension}`;
const modifiedFilePath = path.join(workingDirectory, modifiedFileName);
fs.writeFileSync(modifiedFilePath, modifiedGameJs);

console.log('\n=== Summary ===');
console.log(`Created ${createdFiles.length} files:`);
createdFiles.forEach(file => {
    console.log(`  - ${file.fileName} (method: ${file.methodName})`);
});
console.log(`\nModified ${inputFileName} saved as: ${modifiedFileName}`);
console.log('Process completed successfully!');