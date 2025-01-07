# Use an official Node.js image as the base
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application code into the container
COPY . .

# Expose the port your app will run on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]