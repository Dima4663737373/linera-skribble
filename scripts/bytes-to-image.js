/**
 * Bytes to Image Converter for Linera Data Blobs
 * 
 * Supports:
 *   - Raw binary bytes (from GraphQL dataBlob query)
 *   - Data URL encoded bytes (from image-to-bytes.js)
 *   - GraphQL response format { "data": { "dataBlob": [...] } }
 * 
 * Usage:
 *   node bytes-to-image.js bytes.json output.jpg
 *   node bytes-to-image.js "[255,216,255,...]" output.jpg
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length < 2) {
    console.log('Usage: node bytes-to-image.js <bytes-input> <output-file>');
    console.log('');
    console.log('Converts bytes array to an image file.');
    console.log('Supports raw bytes and Data URL format.');
    console.log('');
    console.log('Examples:');
    console.log('  node bytes-to-image.js bytes.json output.jpg');
    console.log('  node bytes-to-image.js "[255,216,255,...]" output.jpg');
    process.exit(1);
}

const [input, outputPath] = args;

async function main() {
    let bytesArray;

    // Read bytes from file or inline JSON
    if (input.startsWith('[')) {
        bytesArray = JSON.parse(input);
    } else {
        const data = fs.readFileSync(input, 'utf8');
        const parsed = JSON.parse(data);

        // Support GraphQL response format: { "data": { "dataBlob": [...] } }
        if (parsed.data && parsed.data.dataBlob) {
            bytesArray = parsed.data.dataBlob;
        } else if (Array.isArray(parsed)) {
            bytesArray = parsed;
        } else {
            console.error('Error: Unsupported JSON format');
            console.error('Expected: array of bytes or { "data": { "dataBlob": [...] } }');
            process.exit(1);
        }
    }

    // Check if it's Data URL format (starts with "data:")
    const firstChars = String.fromCharCode(...bytesArray.slice(0, 5));

    let imageBuffer;

    if (firstChars === 'data:') {
        // Data URL format: decode base64
        const decoder = new TextDecoder();
        const dataUrl = decoder.decode(new Uint8Array(bytesArray));
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

        if (!match) {
            console.error('Error: Invalid data URL format');
            process.exit(1);
        }

        const [, mimeType, base64Data] = match;
        imageBuffer = Buffer.from(base64Data, 'base64');
        console.log(`  Format: Data URL (${mimeType})`);
    } else {
        // Raw binary bytes - write directly
        imageBuffer = Buffer.from(bytesArray);

        // Detect image type from magic bytes
        let imageType = 'unknown';
        if (bytesArray[0] === 0xFF && bytesArray[1] === 0xD8) {
            imageType = 'JPEG';
        } else if (bytesArray[0] === 0x89 && bytesArray[1] === 0x50) {
            imageType = 'PNG';
        } else if (bytesArray[0] === 0x47 && bytesArray[1] === 0x49) {
            imageType = 'GIF';
        } else if (bytesArray[0] === 0x52 && bytesArray[1] === 0x49) {
            imageType = 'WebP';
        }
        console.log(`  Format: Raw binary (${imageType})`);
    }

    // Write to file
    fs.writeFileSync(outputPath, imageBuffer);

    console.log(`✓ Created ${outputPath}`);
    console.log(`  Size: ${imageBuffer.length} bytes`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
