# 🚀 Render Deployment & Key Rotator Rehberi
**Repo**: `https://github.com/furkanarslangraydomain-stack/awesome-freellm-apis.git`  
**Özellik**: Otomatik API Anahtar Rotasyonu (Failover + Idle Switch) & Ücretsiz Model Kotası Koruma (RPM + TPD Limiter)

---

## 1. Ne İşe Yarar?
Google Gemini ve diğer ücretsiz LLM sağlayıcılarında en büyük problem:
- **15 RPM (Request Per Minute)** sınırına takılıp `429 Too Many Requests` veya `RESOURCE_EXHAUSTED` hatası almak.
- Günlük token (TPD) veya günlük istek (RPD: 1500) sınırını tüketip servisin kilitlenmesi.
- Tek bir anahtara yüklenildiğinde servis kesintisi yaşanması.

Bu eklenti ve `config.yaml`:
1. **Kullanılmayınca veya Boşta Kalınca Değişim (Idle Switch)**: Belirlenen süre (varsayılan: 180s) boyunca anahtar kullanılmadığında yükü dengelemek için sıradaki anahtara geçer.
2. **429 / Kota Aşımında Anında Failover**: Bir anahtar hata verdiğinde kullanıcıya hata dönmeden önce anında arka planda yedek anahtara geçip isteği tamamlar.
3. **Akıllı RPM + TPD Sınırlandırma (Token Bucket & Sliding Window)**: Her anahtar için dakika başına en fazla 14 istek (15 limitine çarpmamak için emniyet payı) ve 1,000,000 TPD kotası uygular. Eşiğe yaklaşan anahtarı dinlendirir (cooldown), diğerine aktarır.
4. **OpenAI Standart Endpoint Desteği (`/v1/chat/completions`)**: Cursor, Claude Code, Cline, Open WebUI veya Python projelerinize tek bir URL ile bağlanabilir.

---

## 2. Render.com Üzerinde Kurulum (3 Adım)

### Adım 1: Depoyu Render'a Bağlayın
1. [Render Dashboard](https://dashboard.render.com/) > **New +** > **Web Service** seçin.
2. `awesome-freellm-apis` reposunu seçin.
3. Ayarlar:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

### Adım 2: Çevre Değişkenlerini (Environment Variables) Tanımlayın
Render Web Service > **Environment** sekmesinde şu değişkenleri ekleyin:

| Değişken Adı | Açıklama | Örnek Değer |
|---|---|---|
| `GEMINI_API_KEYS` | Virgülle ayrılmış birden fazla Gemini anahtarı | `AIzaSyA123...,AIzaSyB456...,AIzaSyC789...` |
| `GEMINI_API_KEY` | (Opsiyonel) Tek anahtar | `AIzaSyA123...` |
| `ROTATION_STRATEGY` | Rotasyon stratejisi | `failover_on_error` veya `round_robin` |
| `NODE_ENV` | Çalışma ortamı | `production` |
| `PORT` | Port | `3000` (veya Render otomatik atar) |

> 💡 **İpucu**: `GEMINI_API_KEYS` değişkenine 3-5 adet ücretsiz Gemini anahtarı eklediğinizde sistem toplamda dakikada **70+ RPM** ve günlük **5,000,000+ TPD** kapasiteye ulaşır, üstelik hiçbir anahtar 429 yemez!

---

## 3. config.yaml Yapılandırması

Proje kök dizinindeki `config.yaml` dosyasında ince ayar yapabilirsiniz:

```yaml
# Ücretsiz Model Kotası Koruma Parametreleri
rate_limits:
  max_rpm_per_key: 14     # Gemini Free sınırı 15 RPM'dir (14 güvenli değer)
  max_tpm_per_key: 1000000# Dakikalık token kotası
  max_rpd_per_key: 1500   # Günlük istek kotası
  max_tpd_per_key: 1000000# Günlük token kotası

rotation:
  strategy: "failover_on_error" # "failover_on_error" | "round_robin" | "least_used"
  switch_on_429: true           # 429 Too Many Requests alınca anında değiştir
  switch_on_quota_exhausted: true # Kota dolunca sonrakine geç
  switch_on_idle: true          # Boşta kalınca diğer anahtara geç
  idle_timeout_seconds: 180     # 3 dakika boşta kalırsa sonraki anahtara devret
  max_retry_attempts: 3         # Başarısız olursa havuzdaki diğer anahtarlarla 3 kez dene
  cooldown_on_rate_limit_seconds: 65 # 429 alan anahtar 65 saniye dinlendirilir
```

---

## 4. Cursor / Claude Code / Python / Open WebUI Entegrasyonu

Render'daki servis URL'iniz örneğin: `https://freellm-api.onrender.com` olsun.

### Python (OpenAI SDK):
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://freellm-api.onrender.com/v1",
    api_key="anything" # Proxy rotatörü yönettiği için herhangi bir string geçerlidir
)

response = client.chat.completions.create(
    model="gemini-3.8-flash",
    messages=[{"role": "user", "content": "Merhaba dünya!"}]
)

print(response.choices[0].message.content)
```

### cURL Test:
```bash
curl -X POST https://freellm-api.onrender.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [{"role": "user", "content": "Test mesajı"}]
  }'
```
