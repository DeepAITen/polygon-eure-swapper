const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_PATH = path.join(__dirname, '..', 'swapper.vault');
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

class SwapperVault {
  constructor(masterPassword) {
    if (!masterPassword) {
      throw new Error('Master password is required');
    }
    this.masterPassword = masterPassword;
  }

  deriveKey(salt) {
    return crypto.pbkdf2Sync(
      this.masterPassword,
      salt,
      600000,
      KEY_LENGTH,
      'sha512'
    );
  }

  save(secrets) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const plaintext = JSON.stringify(secrets, null, 2);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const tag = cipher.getAuthTag();

    // Format: salt(32) + iv(16) + tag(16) + encrypted_data
    const vaultData = Buffer.concat([salt, iv, tag, encrypted]);

    fs.writeFileSync(VAULT_PATH, vaultData);
    return VAULT_PATH;
  }

  load() {
    if (!fs.existsSync(VAULT_PATH)) {
      throw new Error(`Vault not found at ${VAULT_PATH}. Run: npm run setup-vault`);
    }

    const vaultData = fs.readFileSync(VAULT_PATH);

    const salt = vaultData.subarray(0, SALT_LENGTH);
    const iv = vaultData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = vaultData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = vaultData.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = this.deriveKey(salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  get(dotPath) {
    const secrets = this.load();
    const keys = dotPath.split('.');
    let value = secrets;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) {
        throw new Error(`Key not found in vault: ${dotPath}`);
      }
    }
    return value;
  }
}

module.exports = SwapperVault;
