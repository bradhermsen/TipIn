using System;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace TipInAPI.Services
{
    public interface IGatewaySecretProtector
    {
        string Protect(string secret);
        string Unprotect(string protectedSecret);
    }

    public class GatewaySecretProtector : IGatewaySecretProtector
    {
        private readonly byte[] _key;

        public GatewaySecretProtector(IConfiguration configuration)
        {
            var source = configuration["GatewayConfig:EncryptionKey"] ?? configuration["Jwt:Key"];
            if (string.IsNullOrWhiteSpace(source))
                throw new InvalidOperationException("GatewayConfig:EncryptionKey or Jwt:Key must be configured.");

            _key = SHA256.HashData(Encoding.UTF8.GetBytes(source));
        }

        public string Protect(string secret)
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var plaintext = Encoding.UTF8.GetBytes(secret);
            var ciphertext = new byte[plaintext.Length];
            var tag = new byte[16];
            using var aes = new AesGcm(_key, 16);
            aes.Encrypt(nonce, plaintext, ciphertext, tag);

            var payload = new byte[nonce.Length + tag.Length + ciphertext.Length];
            Buffer.BlockCopy(nonce, 0, payload, 0, nonce.Length);
            Buffer.BlockCopy(tag, 0, payload, nonce.Length, tag.Length);
            Buffer.BlockCopy(ciphertext, 0, payload, nonce.Length + tag.Length, ciphertext.Length);
            return Convert.ToBase64String(payload);
        }

        public string Unprotect(string protectedSecret)
        {
            var payload = Convert.FromBase64String(protectedSecret);
            var nonce = payload[..12];
            var tag = payload[12..28];
            var ciphertext = payload[28..];
            var plaintext = new byte[ciphertext.Length];
            using var aes = new AesGcm(_key, 16);
            aes.Decrypt(nonce, ciphertext, tag, plaintext);
            return Encoding.UTF8.GetString(plaintext);
        }
    }
}