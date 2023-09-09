## Installation

Copy `.env.example` to `.env` and put your setting.

- Place your telegram bot token in `API_KEY_BOT`.
- Place your payment token in `PAYMENT_TOKEN`.
- Set the absolute path for sqlite database file in `SQLITE_DB_PATH`.
- Install sqlite3 (if it is not present) on your OS.

Download dependencies and run in NodeJS:

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
