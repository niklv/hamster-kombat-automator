# Refactored Hamster Kombat Automator

### 📜 **Changes from upstream project**
* Updated deps
* Fixed best upgrade purchase
* Disabled Daily Combo collection
* Improved automator logic and wait time for next purchase
* Fixed new domain

### 📜 **Script features**
- caching telegram web data for 24 hours to avoid flood ban
- real user agents (android)
- proxy binding to an account
- support running on multiple accounts (single-threaded execution in parallel mode)
---
### 🤖 **Automator functionality**
- buying upgrades at the best price/profit ratio
- auto-clicker
- use of daily energy recharger
- daily reward collection
- exchange selection
- ability to enable/disable auto-clicker
---
### 📝 Settings via .env file
| Property                 | Description                                                                             |
|--------------------------|-----------------------------------------------------------------------------------------|
| 🔑 **API_ID / API_HASH** | Telegram client app credentials ([FYI](https://core.telegram.org/api/obtaining_api_id)) |
| 🖱️ **TAP_MODE**         | OFF/ON auto clicker (**true / false**) - default **true**                               |
---
### 📥 Installation

1. Download & install bun
2. Clone the repository
3. Create an .env file and insert your values (variables in .env-example)
4. `bun install`

### 🚀 Startup
1. `bun src/index.ts`
2. Select **Add new account** and follow the instructions
3. `bun src/index.ts`
4. Select **Run automator** --> DONE!
