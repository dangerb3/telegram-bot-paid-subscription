## Description

- It is a Telegram bot server that can manage users in SQLite3 database and work with recurrent payments for them.
- There is also Cron task manager, which can control and do user auto payments in the appropriate time.
- Payments working only on Yookassa side because at this moment the Telegram Payments API doesn't support this feature.

### Roles

User:

- Subscribe
- Unsubscribe
- Get payments history report in pdf

Admin:

- Get current subscription price
- Get current payment period
- Change subscription price
- Change payment period
- Export payment history of all users
- Export payment status of all users
- Export unsuccessful payment issues of all users

## Installation

Copy `.env.example` to `.env` and put your setting.

Set `.env` variables:

- Place your telegram bot token in `API_KEY_BOT`.
- Place link to bot in `BOT_LINK`
- Place your payment token in `PAYMENT_TOKEN`.
- Set also `PAYMENT_TOKEN`, `SHOP_SECRET_KEY` from Yookassa
- Set the absolute path for sqlite database file in `SQLITE_DB_PATH`.
- Install sqlite3 (if it is not present) on your OS.

Install nodeJS and yarn, then execute:

    yarn install
    yarn start

## sqlite3 installation

### Windows

- Go to [SQLite download page](https://www.sqlite.org/download.html) and download precompiled binaries for Windows (I choosed a bundle of command-line tools for managing SQLite database files, including the command-line shell program, the sqldiff.exe program, and the sqlite3_analyzer.exe program.).
- Create a folder `C:\>sqlite` or whatever you want and unzip the files inside it ( or just place the file in a folder already in your `PATH`).
- Add `C:\>sqlite` in your `PATH` environment variable.
- Go to terminal and type `sqlite3`, you should see SQLite version number.

### Linux

First option, the easiest, but probably official repositories will not have the last version:

- Open terminal and type `sudo apt-get install sqlite3`

Second option:

- Go to [SQLite download page](https://www.sqlite.org/download.html) and download sqlite-autoconf-\*.tar.gz from source code section.
- Run the following code.
  ```
  tar xvfz sqlite-autoconf-3190300.tar.gz
  cd sqlite-autoconf-3190300
  ./configure --prefix = /usr/local
  make
  make install
  ```

### Mac OS X

- Same procedure than for Linux if sqlite3 is not installed already.
