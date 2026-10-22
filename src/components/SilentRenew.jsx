import React, {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {useOidc} from '../context/OidcAuthContext.tsx';
import logger from '../utils/logger.js';

const SilentRenew = () => {
    const {userManager} = useOidc();
    const {t} = useTranslation();

    useEffect(() => {
        const doSigninSilentCallback = async () => {
            try {
                if (userManager && typeof userManager.signinSilentCallback === 'function') {
                    await userManager.signinSilentCallback();
                    logger.info('Silent renew callback processed successfully');
                } else {
                    logger.warn('UserManager or signinSilentCallback unavailable in silent renew context');
                }
            } catch (err) {
                logger.error('Error during signinSilentCallback:', err);
            }
        };

        void doSigninSilentCallback();
    }, [userManager]);

    return <div>{t('auth.silentRenew.processing')}</div>;
};

export default SilentRenew;
