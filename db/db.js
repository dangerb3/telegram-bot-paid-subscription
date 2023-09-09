import sqlite3 from "sqlite3";
sqlite3.verbose();

let db;

const CREATE =
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, nickname TEXT NOT NULL, fullname TEXT,  time_sub INTEGER, payment_code TEXT, signup TEXT)";
const SELECT_USERS = "SELECT * FROM users";
const INSERT = "INSERT INTO users VALUES (?,?,?,?,?)";
const DELETE = "DELETE FROM users WHERE chatId=?";

const openDb = function () {
  db = new sqlite3.Database(process.env.SQLITE_DB_PATH);
};

const closeDb = function () {
  db.close();
};

const database = {
  init() {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        db.run(CREATE);

        db.all(SELECT_USERS, (err, arrayRows) => {
          console.log(arrayRows);
          if (err) {
            reject();
          } else {
            resolve(arrayRows);
          }

          closeDb();
        });
      });
    });
  },

  addNewUser(userId, nickname, fullname) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        try {
          var stmt = db.prepare(
            `INSERT INTO users (user_id, nickname, fullname) VALUES (?,?,?)`
          );
          stmt.run(userId, nickname, fullname);
          stmt.finalize();
          resolve();
        } catch (e) {
          reject();
        }

        closeDb();
      });
    });
  },

  getUserNickname(userId) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        db.get(
          `SELECT nickname FROM users WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row?.nickname);
            }

            closeDb();
          }
        );
      });
    });
  },

  setSubscription(userId, timeSub, paymentId) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        try {
          db.run(
            "UPDATE users SET time_sub=?, payment_code=? WHERE user_id=?",
            timeSub,
            paymentId,
            userId
          );
          resolve();
        } catch (e) {
          reject(e);
        }

        closeDb();
      });
    });
  },

  getTimeSubscription(userId) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        db.get(
          `SELECT time_sub FROM users WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row.time_sub);
            }

            closeDb();
          }
        );
      });
    });
  },

  // subscribeUser(subscription, chatID) {
  //   return new Promise((resolve, reject) => {
  //     openDb();

  //     db.serialize(() => {
  //       try {
  //         var stmt = db.prepare(INSERT);
  //         stmt.run(
  //           chatID,
  //           subscription.hour,
  //           subscription.minute,
  //           subscription.lat,
  //           subscription.lon
  //         );
  //         stmt.finalize();
  //         resolve();
  //       } catch (e) {
  //         reject();
  //       }

  //       closeDb();
  //     });
  //   });
  // },

  // deleteUser(chatID) {
  //   return new Promise((resolve, reject) => {
  //     openDb();

  //     db.serialize(() => {
  //       try {
  //         var stmt = db.prepare(DELETE);
  //         stmt.run(chatID);
  //         stmt.finalize();
  //         resolve();
  //       } catch (e) {
  //         reject();
  //       }

  //       closeDb();
  //     });
  //   });
  // },
};

// // Export public methods
// module.exports = database;

export default database;
