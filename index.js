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
const gameJsContent = fs.readFileSync(inputFilePath, 'utf8');

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
    // "src/components/Button.tsx" -> "Button.tsx"
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
    fileName = fileName.replace(/^[^a-zA-Z0-9_-]+/, '');
    
    return fileName || null;
}

// Function to create method name from file name
function createMethodName(fileName) {
    // Remove extension and convert to camelCase
    const baseName = path.parse(fileName).name;
    // Convert to PascalCase and prefix with "Register"
    const methodName = 'Register' + baseName.charAt(0).toUpperCase() + baseName.slice(1);
    return methodName;
}

// Find all System.Register calls
const systemRegisterCalls = findSystemRegisterCalls(ast);
console.log(`Found ${systemRegisterCalls.length} System.Register calls`);

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
    
    console.log(`Processing: ${chunkPath} -> ${fileName}`);
    
    // Extract the original System.Register call code
    const originalCode = extractOriginalCode(gameJsContent, call.start, call.end);
    
    // Create method name
    const methodName = createMethodName(fileName);
    
    // Create the new file content
    const newFileContent = `// Generated from ${chunkPath}
function ${methodName}() {
    ${originalCode}
}

module.exports = { ${methodName} };
`;
    
    // Always create .js files for Node.js compatibility
    const baseName = path.parse(fileName).name;
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