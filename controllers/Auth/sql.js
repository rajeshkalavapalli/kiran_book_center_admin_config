// SQL for the owner's sign-in and password.
// Query text only: each entry returns the SQL string, and authDA.js runs it (sql.NAME()).
module.exports = {
    GET_ADMIN_BY_USERNAME: () => {
        return `
            SELECT
                AdminId,
                UserName,
                Name,
                PasswordHash
            FROM dbo.Admins
            WHERE UserName = @UserName
              AND IsActive = 1
        `;
    },

    GET_ADMIN_BY_ID: () => {
        return `
            SELECT
                AdminId,
                UserName,
                Name,
                LastLoginOn
            FROM dbo.Admins
            WHERE AdminId = @Id
              AND IsActive = 1
        `;
    },

    GET_ADMIN_PASSWORD_HASH: () => {
        return `
            SELECT
                PasswordHash
            FROM dbo.Admins
            WHERE AdminId = @Id
              AND IsActive = 1
        `;
    },

    UPDATE_ADMIN_PASSWORD: () => {
        return `
            UPDATE dbo.Admins
            SET PasswordHash = @Hash
            WHERE AdminId = @Id
        `;
    },

    UPDATE_LAST_LOGIN: () => {
        return `
            UPDATE dbo.Admins
            SET LastLoginOn = SYSUTCDATETIME()
            WHERE AdminId = @Id
        `;
    },
};
