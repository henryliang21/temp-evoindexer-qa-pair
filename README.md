# EvoIndexer

## Prepare hosting server
- A hosting server with nginx, node.js (with npm), python version 3.12 (with pip), git tool
- Allow port 22 (ssh), 80 (web for FastAPI), 8081 (web for Next.js), 8082 (web for the Q&A generator)
- Allow ssh access with root privilege
- Ensure nginx is running as a service

## Setup PM2
- run `npm install -g pm2` on the hosting server (please note you may need to run it with `sudo`)
- ensure pm2 is properly installed, run `pm2 -v` to verify the installation

## Build app
- Obtain the source code from gitlab, and ensure checkout `develop` branch
- Copy the `frontend`, `xinren-rag` and `question-answer-generator` directories into `/opt` directory of the server

### Build frontend app
- Run `cd frontend`
- Create a `.env` file and setup the environment variables (will be provided in group chat)
- Run `npm install` to install all dependencies
- Run `npm run build` to build the app
- Run `npm start` to start the app

### Setup PM2 for the frontend
- Run `cd frontend` or ensure current directory is in `frontend`
- Run `pm2 start ecosystem.config.js` to start the pm2 process
- Run `pm2 startup` to add pm2 as a service (you only need to do this once per server)
- Run `pm2 save` to save the pm2 config so it will auto start when the hosting server reboots
- Run `pm2 list` to ensure the evoindexer_frontend app is up and running
- If necessary, run `pm2 restart evoindexer_frontend` (or whatever the app name from `list` command) to restart the app

### Build question-answer-generator app
- Run `cd question-answer-generator`
- Copy `.env.example` to `.env` and fill in the LLM settings: `LLM_PROVIDER` (`anthropic` or `openai`), the API key and model for that provider, and optionally `ANSWER_MAX_CHARS` (default 100)
- Run `npm install` to install all dependencies
- Run `npm run build` to build the app
- Run `pm2 start ecosystem.config.js` to start it on port 3001, then run `pm2 save`
- Run `pm2 list` to ensure `evoindexer-qa-generator` is up and running
- After changing `.env`, run `pm2 restart evoindexer-qa-generator`

### Build xinren-rag app
- Change the directory `xinren-rag` owner is www-data:www-data, by running `sudo chown www-data:www-data xinren-rag` (if www-data user doesn't exist, check the server distro how to create the user)
- Run `cd xinren-rag`
- Run `sudo mkdir data` to create the data directory, then copy the initial data files (xlsx, csv) into this location
- Run `cd ..` then run `sudo mkdir models` to create the model file, then copy the model file into this location. The model files are in `models--BAAI--bge-large-zh-v1.5` directory
- Ensure `config/server.yml` contains initial retrievers info
- Run `python -m venv .venv` to create a virtual environment (use `python3` cmd in case `python` not found)
- Run `source .venv/bin/activate` to enable the virtual environment
- Run `pip install -r requirements.txt` to install the dependencies
- Run `PYTHONPATH=./app RAG_CONFIG_FILE=config/server-test-one-chain.yml python ./app/server.py` to ensure the app can start, then use `ctrl + c` to stop it

## Setup Xinren-rag Service
- From the workdir, run `cd xinren-rag` to go to the xinren-rag directory
- Run `sudo cp xinren-rag.service /etc/systemd/system/` to copy the serice to systemd directory, to enable the backend service can run as a service
- Edit the `/etc/systemd/system/xinren-rag.service` file to ensure the environment variables and the paths are correct
- Run `sudo systemctl reload-daemon` and then `sudo systemctl enable xinren-rag.service`, then `sudo systemctl start xinren-rag.service` to start the service;
- Run `sudo systemctl status xinren-rag.service` to ensure it's successfully started

## Setup Nginx
- Go to `frontend` directory and copy `evoindexer.nginx.conf` to `/etc/nginx/sites-available` (or nginx conf subdirectory), ensure the `server_name` in the config file is correct
- Go to `xinren-rag` directory and copy `xinren-rag.nginx.conf` to `/etc/nginx/sites-available`, ensure the `server_name` in the config file is correct
- Go to `question-answer-generator` directory and copy `qa-generator.nginx.conf` to `/etc/nginx/sites-available`, ensure the `server_name` in the config file is correct
- Create 3 symbolic links pointing the 3 conf files we created in previous steps, into `/etc/nginx/sites-enabled`
- - Run `sudo systemctl reload-daemon` and then `sudo systemctl restart nginx.service`, to reload the nginx service;
- Run `sudo systemctl status nginx.service` to ensure it's successfully started
- Depends on the count of the build-in retriever in `xinren-rag/config/server.yml`, the app may take a bit of time to be loaded

## Run with Docker
- Create `question-answer-generator/.env` from `question-answer-generator/.env.example` and fill in the LLM settings
- Run `docker compose up -d --build`
- The retriever dashboard is served on port 80 and the Q&A generator on port 8082