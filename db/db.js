import sqlite3 from "sqlite3";
sqlite3.verbose();

// let db;

const columns =
  "(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nickname TEXT NOT NULL, fullname TEXT, time_sub INTEGER, payment_code TEXT, payment_method TEXT, card_numbers TEXT, payment_status TEXT, payment_date TEXT)";
const CREATE_USERS_TABLE = "CREATE TABLE IF NOT EXISTS users " + columns;
const CREATE_PAYMENTS_TABLE = "CREATE TABLE IF NOT EXISTS payments " + columns;
const CREATE_USERS_CHAT_TABLE =
  "CREATE TABLE IF NOT EXISTS users_chats " +
  "(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nickname TEXT NOT NULL, chat_id INTEGER NOT NULL, UNIQUE(user_id, chat_id))";

const SELECT_USERS = "SELECT * FROM users";
const INSERT = "INSERT INTO users VALUES (?,?,?,?,?)";
const DELETE = "DELETE FROM users WHERE chatId=?";

const POOL_SIZE = 50;
const connectionPool = [];

function initializeConnectionPool() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const db = new sqlite3.Database(process.env.SQLITE_DB_PATH);
    connectionPool.push(db);
  }
}

function getConnection() {
  if (connectionPool.length === 0) {
    throw new Error("No available connections in the pool.");
  }
  return connectionPool.pop();
}

function releaseConnection(db) {
  connectionPool.push(db);
}

// const openDb = function () {
//   db = new sqlite3.Database(process.env.SQLITE_DB_PATH);
// };

// const closeDb = function () {
//   db.close();
// };

const database = {
  init() {
    initializeConnectionPool();

    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        try {
          db.run(CREATE_USERS_TABLE);
          db.run(CREATE_PAYMENTS_TABLE);
          db.run(CREATE_USERS_CHAT_TABLE);

          resolve();
        } catch (e) {
          reject(e);
        }

        releaseConnection(db);
      });
    });
  },

  addNewUser(userId, nickname, fullname) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        try {
          let stmt = db.prepare(
            `INSERT INTO users (user_id, nickname, fullname) VALUES (?,?,?)`
          );
          stmt.run(userId, nickname, fullname);
          stmt.finalize();
          resolve();
        } catch (e) {
          reject();
        }

        releaseConnection(db);
      });
    });
  },

  getUserNickname(userId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.get(
          `SELECT nickname FROM users WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row?.nickname);
            }

            releaseConnection(db);
          }
        );
      });
    });
  },

  setSubscription(
    userId,
    timeSub,
    paymentId,
    paymentMethod,
    cardNumbers,
    paymentStatus,
    paymentDate
  ) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        try {
          db.run(
            "UPDATE users SET time_sub=?, payment_code=?, payment_method=?, card_numbers=?, payment_status=?, payment_date=? WHERE user_id=?",
            timeSub,
            paymentId,
            paymentMethod,
            cardNumbers,
            paymentStatus,
            paymentDate,
            userId
          );
          resolve();
        } catch (e) {
          reject(e);
        }

        releaseConnection(db);
      });
    });
  },

  updatePaymentHistory(userId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        try {
          db.run(
            "INSERT INTO payments (user_id, nickname, fullname, time_sub, payment_code, payment_method, card_numbers, payment_status, payment_date) SELECT user_id, nickname, fullname, time_sub, payment_code, payment_method, card_numbers, payment_status, payment_date FROM users WHERE user_id=?",
            userId
          );
          resolve();
        } catch (e) {
          reject(e);
        }

        releaseConnection(db);
      });
    });
  },

  getTimeSubscription(userId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.get(
          `SELECT time_sub FROM users WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row.time_sub);
            }

            releaseConnection(db);
          }
        );
      });
    });
  },

  getPaymentsHistory(userId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.all(
          `SELECT time_sub, payment_code, card_numbers, payment_status, payment_date  FROM payments WHERE user_id='${userId}'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }

            releaseConnection(db);
          }
        );
      });
    });
  },

  getAllUsersPaymentsHistory() {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.all(`SELECT * FROM payments`, (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }

          releaseConnection(db);
        });
      });
    });
  },

  getAllUsersSubscriptionStatus() {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.all(`SELECT * FROM users`, (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }

          releaseConnection(db);
        });
      });
    });
  },

  getAllUsersWithBadSubscriptionStatus() {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.all(
          `SELECT * FROM users WHERE payment_status!='succeeded'`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }

            releaseConnection(db);
          }
        );
      });
    });
  },

  addNewUserChat(userId, username, chatId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        try {
          let stmt = db.prepare(
            `INSERT OR IGNORE INTO users_chats (user_id, nickname, chat_id) VALUES (?,?,?)`
          );
          stmt.run(userId, username, chatId);
          stmt.finalize();
          resolve();
        } catch (e) {
          reject();
        }

        releaseConnection(db);
      });
    });
  },

  getAllUsersChats() {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.all(`SELECT * FROM users_chats`, (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }

          releaseConnection(db);
        });
      });
    });
  },

  getUserChatByUserId(userId) {
    return new Promise((resolve, reject) => {
      const db = getConnection();

      db.serialize(() => {
        db.get(
          `SELECT chat_id FROM users_chats WHERE user_id=${userId}`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row.chat_id);
            }

            releaseConnection(db);
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
