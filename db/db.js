import sqlite3 from "sqlite3";
sqlite3.verbose();

let db;

const columns =
  "(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nickname TEXT NOT NULL, fullname TEXT, time_sub INTEGER, payment_code TEXT, card_numbers TEXT, payment_status TEXT, payment_date TEXT)";
const CREATE_USERS_TABLE = "CREATE TABLE IF NOT EXISTS users " + columns;
const CREATE_PAYMENTS_TABLE = "CREATE TABLE IF NOT EXISTS payments " + columns;

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
        db.run(CREATE_USERS_TABLE);
        db.run(CREATE_PAYMENTS_TABLE);

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
    console.log("add new user");
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

  setSubscription(
    userId,
    timeSub,
    paymentId,
    cardNumbers,
    paymentStatus,
    paymentDate
  ) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        try {
          db.run(
            "UPDATE users SET time_sub=?, payment_code=?, card_numbers=?, payment_status=?, payment_date=? WHERE user_id=?",
            timeSub,
            paymentId,
            cardNumbers,
            paymentStatus,
            paymentDate,
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

  updatePaymentHistory(userId) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        try {
          db.run(
            "INSERT INTO payments (user_id, nickname, fullname, time_sub, payment_code, card_numbers, payment_status, payment_date) SELECT user_id, nickname, fullname, time_sub, payment_code, card_numbers, payment_status, payment_date FROM users WHERE user_id=?",
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

  getPaymentsHistory(userId) {
    return new Promise((resolve, reject) => {
      openDb();

      db.serialize(() => {
        db.all(
          `SELECT time_sub, payment_code, card_numbers, payment_status, payment_date  FROM payments WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
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
