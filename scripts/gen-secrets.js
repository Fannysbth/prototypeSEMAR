import crypto from 'node:crypto';
const g = () => crypto.randomBytes(32).toString('hex');
console.log(`JWT_SECRET=${g()}\nHMAC_MASTER_KEY=${g()}\nINTERNAL_API_KEY=${g()}`);
console.error('\n(Salin tiga baris di atas ke .env atau ke Variables Railway. Simpan HMAC_MASTER_KEY baik-baik: mengganti nilainya membuat token lama tidak bisa dibuka.)');
