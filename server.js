const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'super_secret_key_for_cursach';

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Иуук!',
    database: 'stomat',
    waitForConnections: true,
    connectionLimit: 10
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Ошибка подключения к БД', err.message);
    } else {
        console.log('Успешное подключение к БД');
        connection.release();
    }
});

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Нет токена доступа' });
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

app.post('/api/register', async (req, res) => {
    try {
        const { Имя, Фамилия, Логин, Пароль, Телефон, ID_role } = req.body;
        const hashedPassword = await bcrypt.hash(Пароль, 10);
        const query = `INSERT INTO users (Имя, Фамилия, Логин, Пароль, Телефон, ID_role, \`Дата регистрации\`) VALUES (?, ?, ?, ?, ?, ?, NOW())`;
        
        db.query(query, [Имя, Фамилия, Логин, hashedPassword, Телефон, ID_role || 2], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const userId = result.insertId;
            db.query(`INSERT INTO user_bonuses (ID_user, \`Доступно бонусов\`) VALUES (?, 0)`, [userId], () => {});
            res.json({ message: 'Пользователь зарегистрирован!' });
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', (req, res) => {
    const { Логин, Пароль } = req.body;
    const query = `SELECT u.*, r.\`Название роли\` as RoleName FROM users u JOIN role r ON u.ID_role = r.ID_role WHERE u.Логин = ?`;

    db.query(query, [Логин], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(400).json({ error: 'Пользователь не найден' });

        const user = results[0];
        const isValidPassword = await bcrypt.compare(Пароль, user.Пароль);
        if (!isValidPassword) return res.status(400).json({ error: 'Неверный пароль' });

        const token = jwt.sign({ id: user.ID_users, role: user.RoleName }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, role: user.RoleName, name: user.Имя });
    });
});

app.get('/api/profile', verifyToken, (req, res) => {
    const userId = req.user.id;
    const query = `
        SELECT u.ID_users, u.Имя, u.Фамилия, u.Логин, u.Телефон, 
               COALESCE(b.\`Доступно бонусов\`, 0) as bonuses
        FROM users u
        LEFT JOIN user_bonuses b ON u.ID_users = b.ID_user
        WHERE u.ID_users = ?
    `;
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(results[0]);
    });
});

app.post('/api/appointment', verifyToken, (req, res) => {
    const { Услуга, Дата_время } = req.body;
    const userId = req.user.id;

    db.query('SELECT ID_services FROM services WHERE Название = ?', [Услуга], (err, serviceRes) => {
        if (!err && serviceRes.length > 0) {
            insertAppointment(serviceRes[0].ID_services);
        } else {
            db.query('SELECT ID_services FROM services LIMIT 1', (err2, defaultRes) => {
                if (!err2 && defaultRes.length > 0) {
                    insertAppointment(defaultRes[0].ID_services);
                } else {
                    db.query('INSERT INTO services (Название, Описание, Цена) VALUES (?, "Описание услуги", 1000)', [Услуга], (err3, insRes) => {
                        if (err3) {
                            return res.status(500).json({ error: 'Ошибка: таблица services пуста и не удалось добавить услугу.' });
                        }
                        insertAppointment(insRes.insertId);
                    });
                }
            });
        }
    });

    function insertAppointment(serviceId) {
        const query = `INSERT INTO appointment (ID_user, ID_services, \`Дата записи\`) VALUES (?, ?, ?)`;
        db.query(query, [userId, serviceId, Дата_время], (err, result) => {
            if (err) return res.status(500).json({ error: 'Ошибка записи на прием в базу данных: ' + err.message });
            
            const appointmentId = result.insertId;

            db.query(`INSERT INTO bonuses (\`Тип бонусов\`, ID_appointment) VALUES ('Запись', ?)`, [appointmentId], (err, bonusRes) => {
                const bonusId = bonusRes ? bonusRes.insertId : null;
                db.query(`UPDATE user_bonuses SET \`Доступно бонусов\` = \`Доступно бонусов\` + 50, ID_bonuses = ? WHERE ID_user = ?`, [bonusId, userId], () => {});
            });

            res.json({ message: 'Успешная запись! Начислено 50 бонусов.' });
        });
    }
});

app.post('/api/reviews', verifyToken, (req, res) => {
    const userId = req.user.id;
    const { Рейтинг, Текст } = req.body;

    db.query('SELECT * FROM reviews WHERE ID_user = ?', [userId], (err, existing) => {
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: 'Вы можете оставить отзыв только один раз!' });
        }

        const query = `INSERT INTO reviews (ID_user, Рейтинг, Текст, \`Дата публикации\`) VALUES (?, ?, ?, NOW())`;
        db.query(query, [userId, Рейтинг, Текст], (err, result) => {
            if (err) return res.status(500).json({ error: 'Ошибка сохранения отзыва' });

            const ratingId = result.insertId;

            db.query(`INSERT INTO bonuses (\`Тип бонусов\`, ID_rating) VALUES ('Отзыв', ?)`, [ratingId], (err, bonusRes) => {
                const bonusId = bonusRes ? bonusRes.insertId : null;
                db.query(`UPDATE user_bonuses SET \`Доступно бонусов\` = \`Доступно бонусов\` + 30, ID_bonuses = ? WHERE ID_user = ?`, [bonusId, userId], () => {});
            });

            res.json({ message: 'Отзыв успешно добавлен! Начислено 30 бонусов.' });
        });
    });
});

app.delete('/api/profile/delete', verifyToken, (req, res) => {
    const userId = req.user.id;
    
    db.query(`DELETE FROM user_bonuses WHERE ID_user = ?`, [userId], () => {
        db.query(`DELETE FROM appointment WHERE ID_user = ?`, [userId], () => {
            db.query(`DELETE FROM reviews WHERE ID_user = ?`, [userId], () => {
                db.query(`DELETE FROM users WHERE ID_users = ?`, [userId], (err, result) => {
                    if (err) return res.status(500).json({ error: 'Ошибка при удалении профиля' });
                    res.json({ message: 'Профиль успешно удален' });
                });
            });
        });
    });
});

app.get('/api/reviews', (req, res) => {
    const query = `
        SELECT r.ID_reviews, r.Рейтинг, r.Текст, r.\`Дата публикации\`, u.Имя, u.Фамилия 
        FROM reviews r 
        JOIN users u ON r.ID_user = u.ID_users 
        ORDER BY r.ID_reviews DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/admin/users', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    db.query('SELECT ID_users, Имя, Фамилия, Логин, Телефон, \`Дата регистрации\` FROM users', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.delete('/api/admin/user/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    const uid = req.params.id;
    db.query(`DELETE FROM user_bonuses WHERE ID_user = ?`, [uid], () => {
        db.query(`DELETE FROM appointment WHERE ID_user = ?`, [uid], () => {
            db.query(`DELETE FROM reviews WHERE ID_user = ?`, [uid], () => {
                db.query('DELETE FROM users WHERE ID_users = ?', [uid], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Пользователь удален' });
                });
            });
        });
    });
});

app.get('/api/admin/appointments', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    const query = `
        SELECT a.ID_appointment AS ID_записи, a.ID_user AS ID_users, s.Название AS Услуга, a.\`Дата записи\` AS Дата_время
        FROM appointment a
        LEFT JOIN services s ON a.ID_services = s.ID_services
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.delete('/api/admin/appointment/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    db.query('DELETE FROM appointment WHERE ID_appointment = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Запись отменена' });
    });
});

app.get('/api/admin/reviews', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    db.query('SELECT * FROM reviews ORDER BY ID_reviews DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.delete('/api/admin/review/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') return res.status(403).json({ error: 'Доступ запрещен' });
    db.query('DELETE FROM reviews WHERE ID_reviews = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Отзыв успешно удален' });
    });
});

app.use(express.static(__dirname));
app.listen(3000, () => console.log('Сервер запущен на порту 3000'));