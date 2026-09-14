FROM python:3.11-slim

WORKDIR /app

# LiteLLM ve proxy için gerekli kütüphaneleri yüklüyoruz
RUN pip install --no-cache-dir litellm[proxy]

# Depodaki config.yaml dosyasını konteynere kopyalıyoruz
COPY config.yaml /app/config.yaml

# Render'ın dışarıya vereceği port (Varsayılan 4000)
EXPOSE 4000

# LiteLLM proxy'yi config dosyasıyla başlatıyoruz
CMD ["litellm", "--config", "/app/config.yaml", "--port", "4000"]
