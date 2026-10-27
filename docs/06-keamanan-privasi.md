# Keamanan dan Privasi

## Kontrol
| Area | Kontrol |
|---|---|
| Identitas | HMAC-SHA256 berkunci, kunci per epoch 30 hari, token per tujuan, revoke |
| Penyimpanan | Kolom identitas AES-256-GCM, skema `vault` terpisah, kredensial DB per layanan |
| Akses | JWT 15 menit, RBAC per endpoint, faskes hanya melihat klaimnya |
| Buka identitas | Hanya auditor, alasan wajib, kuota harian, opsional persetujuan kedua, audit |
| Audit | `audit_log` berantai hash, tidak bisa diubah lewat API |
| AI | LLM hanya menerima token; penyaring PII sebelum panggilan; fallback templat |
| Transport | TLS di depan gateway (reverse proxy) untuk pilot; antar layanan di jaringan privat |
| Input | Validasi skema CSV dan JSON, batas ukuran unggah, rate limit login dan /verify |
| Rahasia | `.env`, tidak di repo. Roadmap: KMS/HSM |

## Tes keamanan (pertahankan dan tambah)
Tes prototype (22) tetap jalan. Tambahan: RBAC per peran, kuota reveal, reveal tanpa alasan ditolak, token tercabut tidak diproses, PII tidak ada di log layanan token, payload LLM bebas PII, rantai hash audit valid.

## DPIA ringkas
| Butir | Isi |
|---|---|
| Tujuan pemrosesan | Deteksi dan pencegahan kecurangan klaim JKN |
| Data | Identitas peserta, data kunjungan, diagnosis, tindakan, tarif |
| Dasar | Pelaksanaan tugas BPJS sebagai penyelenggara JKN (dikonfirmasi tim hukum BPJS) |
| Minimisasi | Analitik hanya memakai token dan atribut klinis/tarif |
| Pihak yang mengakses | Verifikator, auditor (identitas hanya via reveal), admin, DPO |
| Risiko utama | Re-identifikasi dari pola kunjungan; penyalahgunaan reveal; kebocoran kunci master |
| Mitigasi | Token per tujuan dan rotasi; kuota + alasan + audit; kunci di KMS (roadmap); peninjauan log reveal oleh DPO tiap bulan |
| Risiko sisa | Re-identifikasi oleh orang dalam yang punya data eksternal; ditangani dengan kontrol akses dan audit |
| Hak subjek | Akses dan koreksi melalui kanal BPJS yang ada; SAMAR mendukung pelacakan via token |
| Retensi | Klaim ter-token mengikuti kebijakan BPJS; pemetaan token epoch lama dihapus setelah masa audit |

Pernyataan: SAMAR dirancang selaras prinsip UU PDP (minimisasi, pembatasan tujuan, akuntabilitas). Ini bukan sertifikasi kepatuhan.
