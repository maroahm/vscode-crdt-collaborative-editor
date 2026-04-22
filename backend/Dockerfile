# Use the latest Ubuntu which has the correct GLIBC version
FROM ubuntu:24.04

# Prevent Ubuntu from pausing the build to ask for timezone input
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 20 natively
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs

# Set up your project
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Expose the ports and start the server
EXPOSE 3000 4433
CMD ["node", "http3-server.mjs"]