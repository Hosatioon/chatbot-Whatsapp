FROM node:20-slim

# Instalar dependencias nativas para better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar dependencias primero para cachear el layer de npm install
COPY package*.json ./
RUN npm ci

# Copiar el resto del código
COPY . .

# Crear directorios para volúmenes persistentes (necesario antes del build para SQLite)
RUN mkdir -p data auth

# Build de Next.js (necesita env vars en build time si se usan en el frontend)
# Se pueden inyectar vía --build-arg o .env.local
ENV NEXT_PHASE=phase-production-build
RUN npm run build
ENV NEXT_PHASE=

EXPOSE 3000

CMD ["npm", "run", "start"]
