/**
 * Image to Bytes Converter for Linera Data Blobs
 * 
 * Usage in browser:
 *   const bytes = await imageToBytes(file);
 *   
 * Usage in Node.js:
 *   node image-to-bytes.js path/to/image.png
 */

// ============== Browser Usage ==============

/**
 * Convert a File/Blob to Data URL bytes array
 * @param {File|Blob} file - Image file from input or drag-drop
 * @returns {Promise<number[]>} - Array of bytes ready for GraphQL
 */
async function imageToBytes(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result; // "data:image/png;base64,..."
            const encoder = new TextEncoder();
            const bytes = Array.from(encoder.encode(dataUrl));
            resolve(bytes);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Convert bytes array back to image Data URL
 * @param {number[]|Uint8Array} bytes - Bytes from data blob
 * @returns {string} - Data URL for <img src="...">
 */
function bytesToImage(bytes) {
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(bytes));
}

/**
 * Publish image to Linera data blob via GraphQL
 * @param {ApolloClient} client - Node service GraphQL client
 * @param {string} chainId - Chain ID to publish on
 * @param {File} file - Image file
 * @returns {Promise<string>} - Blob hash
 */
async function publishImageBlob(client, chainId, file) {
    const bytes = await imageToBytes(file);

    const PUBLISH_DATA_BLOB = `
    mutation PublishDataBlob($chainId: ChainId!, $bytes: [Int!]!) {
      publishDataBlob(chainId: $chainId, bytes: $bytes)
    }
  `;

    const result = await client.mutate({
        mutation: PUBLISH_DATA_BLOB,
        variables: { chainId, bytes }
    });

    return result.data.publishDataBlob;
}

// ============== Node.js CLI Usage ==============
// Run: node image-to-bytes.js image.png

if (typeof process !== 'undefined' && process.argv) {
    const fs = require('fs');
    const path = require('path');

    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node image-to-bytes.js <image-path>');
        console.log('');
        console.log('Converts image to Data URL bytes array for Linera data blobs.');
        console.log('');
        console.log('Example:');
        console.log('  node image-to-bytes.js image.png');
        console.log('  node image-to-bytes.js image.png > bytes.json');
    } else {
        const imagePath = args[0];
        const ext = path.extname(imagePath).toLowerCase();

        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
        };

        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        const fileBuffer = fs.readFileSync(imagePath);
        const base64 = fileBuffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;

        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(dataUrl));

        console.log(JSON.stringify(bytes));
        console.error(`\n✓ Converted ${imagePath} (${fileBuffer.length} bytes) → ${bytes.length} bytes as Data URL`);
    }
}

// Export for module usage
if (typeof module !== 'undefined') {
    module.exports = { imageToBytes, bytesToImage, publishImageBlob };
}
