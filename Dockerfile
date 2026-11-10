# Dockerfile
# Use official lightweight Node.js LTS image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker cache for dependencies
COPY package*.json ./

# Install production dependencies (or all dependencies if devDependencies are needed)
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port your Express app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]