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

        const query = `INSERT INTO Users (Имя, Фамилия, Логин, Пароль, Телефон, ID_role, \`Дата регистрации\`) VALUES (?, ?, ?, ?, ?, ?, NOW())`;
        
        db.query(query, [Имя, Фамилия, Логин, hashedPassword, Телефон, ID_role || 2], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Пользователь зарегистрирован!' });
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', (req, res) => {
    const { Логин, Пароль } = req.body;
    
    const query = `SELECT u.*, r.\`Название роли\` as RoleName 
                   FROM Users u 
                   JOIN Role r ON u.ID_role = r.ID_role 
                   WHERE u.Логин = ?`;

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

app.get('/api/services', (req, res) => {
    db.query('SELECT * FROM Услуги', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/admin/users', verifyToken, (req, res) => {
    if (req.user.role !== 'Администратор') {
        return res.status(403).json({ error: 'Доступ запрещен. Нужны права администратора.' });
    }

    db.query('SELECT ID_users, Имя, Фамилия, Логин, Телефон, \`Дата регистрации\` FROM Users', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.listen(3000, () => console.log('Сервер запущен'));