// Creates the owner's admin login, or sets a new password for an existing one.
// Run in a terminal:   npm run create-admin
// You type the username, name and password; the password is stored as an argon2 hash.
const readline = require('readline');
const argon2 = require('argon2');

const { customQuery } = require('../utils/dbFunctions');
const db = require('../db');

// Arrow keys in some terminals arrive as escape codes: drop them and any other control characters.
const clean = (text) => String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
const ask = (rl, question) => new Promise((resolve) => rl.question(question, (answer) => resolve(clean(answer))));

// Reads a line without showing what is typed.
const askHidden = (question) =>
    new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl.stdoutMuted = true;
        rl._writeToOutput = (text) => {
            if (!rl.stdoutMuted || text.includes(question)) rl.output.write(text);
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
    });

const strongEnough = (password) => password.length >= 10 && /[a-z]/i.test(password) && /\d/.test(password);

(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('Kiran Book Center: owner admin login\n');
    const userName = (await ask(rl, 'Username: ')).toLowerCase();
    if (!/^[a-z0-9._@-]{3,60}$/.test(userName)) throw new Error('Use 3-60 letters, digits or . _ @ -');

    const [existing] = await customQuery('SELECT AdminId, Name FROM dbo.Admins WHERE UserName = @UserName', { UserName: userName });
    const name = existing ? existing.Name : await ask(rl, 'Full name: ');
    rl.close();
    if (!name) throw new Error('Enter a name.');
    if (existing) console.log(`"${userName}" already exists: you are setting a new password.`);

    const password = await askHidden('Password (at least 10 characters, with a letter and a digit): ');
    if (!strongEnough(password)) throw new Error('The password is too weak.');
    const again = await askHidden('Type it again: ');
    if (again !== password) throw new Error("The passwords don't match.");

    const hash = await argon2.hash(password);
    if (existing) {
        await customQuery('UPDATE dbo.Admins SET PasswordHash = @Hash, IsActive = 1 WHERE AdminId = @Id', { Hash: hash, Id: existing.AdminId });
        console.log('Password updated.');
    } else {
        await customQuery('INSERT INTO dbo.Admins (UserName, Name, PasswordHash) VALUES (@UserName, @Name, @Hash)', { UserName: userName, Name: name, Hash: hash });
        console.log(`Admin "${userName}" created. Sign in at the admin panel.`);
    }
    const pool = await db.poolPromise;
    await pool.close();
})().catch(async (error) => {
    console.error(`\nNot saved: ${error.message}`);
    process.exitCode = 1;
    try {
        const pool = await db.poolPromise;
        await pool.close();
    } catch {
        // pool never opened
    }
});
