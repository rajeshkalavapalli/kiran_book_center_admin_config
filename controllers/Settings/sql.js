// SQL for shop settings and delivery zones.
// Query text only: each entry returns the SQL string, and settingsDA.js runs it (sql.NAME()).
module.exports = {
    GET_SHIPPING_ZONES: () => {
        return `
            SELECT
                ZoneId,
                Code,
                Name,
                Charge,
                FreeAbove,
                EtaDays,
                IsActive
            FROM dbo.ShippingZones
            ORDER BY CASE Code WHEN 'LOCAL' THEN 1 WHEN 'STATE' THEN 2 ELSE 3 END
        `;
    },

    GET_LOCAL_PINCODES: () => {
        return `
            SELECT
                p.Pincode
            FROM dbo.ShippingZonePincodes p
            JOIN dbo.ShippingZones z ON z.ZoneId = p.ZoneId
            WHERE z.Code = 'LOCAL'
            ORDER BY p.Pincode
        `;
    },

    // Updates the setting, or adds it (not public) if it doesn't exist yet.
    UPSERT_SETTING: () => {
        return `
            UPDATE dbo.ShopSettings
            SET SettingValue = @V,
                UpdatedOn = SYSUTCDATETIME()
            WHERE SettingKey = @K;

            IF @@ROWCOUNT = 0
                INSERT INTO dbo.ShopSettings (SettingKey, SettingValue, IsPublic)
                VALUES (@K, @V, 0);
        `;
    },

    UPDATE_SHIPPING_ZONE: () => {
        return `
            UPDATE dbo.ShippingZones
            SET Charge = @Charge,
                FreeAbove = @FreeAbove,
                EtaDays = @EtaDays,
                IsActive = @IsActive
            WHERE Code = @Code
        `;
    },

    GET_LOCAL_ZONE: () => {
        return `
            SELECT
                ZoneId
            FROM dbo.ShippingZones
            WHERE Code = 'LOCAL'
        `;
    },

    DELETE_ZONE_PINCODES: () => {
        return `
            DELETE FROM dbo.ShippingZonePincodes
            WHERE ZoneId = @ZoneId
        `;
    },

    INSERT_ZONE_PINCODE: () => {
        return `
            INSERT INTO dbo.ShippingZonePincodes (
                ZoneId,
                Pincode
            ) VALUES (
                @ZoneId,
                @Pincode
            )
        `;
    },
};
