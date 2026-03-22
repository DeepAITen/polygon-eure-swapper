# Polygon EURe Swapper

Système de conversion automatique entre stablecoins (USDT, USDC) et EURe sur Polygon.

## Features
- Swap USDT/USDC → EURe
- Swap EURe → USDT/USDC
- Vault sécurisé pour private key
- Interface simple pour transactions
- **LiFi integration** : routing automatique vers la meilleure source de liquidité (SushiSwap, Uniswap, QuickSwap, etc.)

## Stack
- Node.js + ethers.js
- Polygon network
- LiFi DEX aggregator (gratuit, sans API key)

## Setup
```bash
npm install
```

Configuration du vault (une seule fois) :
```bash
export SWAPPER_VAULT_PASSWORD='ton_password_vault'
node scripts/setup-vault.js
# Enter private key when prompted
```

## Usage
```bash
export SWAPPER_VAULT_PASSWORD='ton_password_vault'

# Dry-run (simulation)
node bin/swap.js --from USDT --to EURe --amount 10 --dry-run

# Swap réel 100 USDC vers EURe
node bin/swap.js --from USDC --to EURe --amount 100

# Swap 50 EURe vers USDT
node bin/swap.js --from EURe --to USDT --amount 50

# Ou via npm scripts
npm run swap -- --from USDT --to EURe --amount 10 --dry-run
```

## Check Balance
```bash
export SWAPPER_VAULT_PASSWORD='ton_password_vault'
node scripts/check-balance.js
```

## Tokens Supportés
- **USDC** : 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
- **USDT** : 0xc2132D05D31c914a87C6611C10748AEb04B58e8F
- **EURe** : 0x18ec0A6E18E5bc3784fDd3a3634b31245ab704F6

## Sécurité
- Private key stockée dans vault chiffré (AES-256-GCM + PBKDF2)
- Password vault requis pour déchiffrer
- Jamais de private key hardcodée dans le code
- .gitignore configuré (node_modules, .env, *.vault)

## License
MIT
