
### Ghost Blog Docker Setup

  

Badges: Docker Ready, Ghost Blog

  

----------------------------

  

TIẾNG VIỆT

  

Giới thiệu Dự án chạy Ghost Blog bằng Docker với MariaDB làm database.

  

Yêu cầu

- Docker

- Docker Compose

  

Cách chạy project

  

## Clone project

  

git clone [https://github.com/tinboy16/school-ghost.git](https://github.com/tinboy16/school-ghost.git)

cd school-ghost

  
## Chạy project bằng Docker

  

docker compose up -d

  

## Truy cập website

  

[http://localhost:**2368**](http://localhost:**2368**)

  

Dừng project docker compose down

  

Cấu trúc project


├── docker-compose.yml

├── .env

├── content/

├── db/

└── README.md

  

Lưu ý quan trọng

- Không push file .env lên GitHub

- db/ chứa dữ liệu database

- content/ chứa dữ liệu Ghost (posts, themes, uploads)

  

----------------------------

  

**ENGLISH**

  

Introduction This project runs a Ghost Blog using Docker with MariaDB as the database.

  

Requirements

- Docker

- Docker Compose

  

How to run

  

## Clone the project

  

git clone [https://github.com/tinboy16/school-ghost.git](https://github.com/tinboy16/school-ghost.git)

cd school-ghost


## Start containers

  

docker compose up -d

  

## Open browser

  

[http://localhost:**2368**](http://localhost:**2368**)

  

Stop project docker compose down

  

Project structure



├── docker-compose.yml

├── .env

├── content/

├── db/

└── README.md

  

Notes

- Do not push .env to GitHub

- db/ stores database data

- content/ stores Ghost content (posts, themes, uploads)