const sqlite3 = require("sqlite3").verbose();
let db;

const CREATE =
  "CREATE TABLE IF NOT EXISTS users (id INTEGER, user_id INTEGER, nickname TEXT, time_sub INTEGER, payment_code TEXT, signup TEXT )";
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

  setTimeSubscription(userId, timeSub) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        try {
          var stmt = db.prepare("UPDATE users SET time_sub=? WHERE user_id=?");
          stmt.run(timeSub, userId);
          stmt.finalize();
          resolve();
        } catch (e) {
          reject();
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

// Export public methods
module.exports = database;
