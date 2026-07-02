import fs from 'fs';
import { generateAttestationPdf } from '../lib/attestation_pdf.js';

// CLI wrapper used by the generate-attestation GitHub Action.
// Usage: node scripts/populate_pdf.js <base64-json-payload>
// Prints the output file path on the last line of stdout.
async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node populate_pdf.js <base64-json-payload>');
    process.exit(1);
  }

  const payload = JSON.parse(Buffer.from(arg, 'base64').toString('utf8'));
  const outBytes = await generateAttestationPdf(payload);
  const outPath = `/tmp/attestation_${Date.now()}.pdf`;
  fs.writeFileSync(outPath, outBytes);
  console.log(outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
