export default function TestEnvironmentWarning() {
    return (
        <div className="sticky-alert" aria-hidden="true">
            <div className="sticky-alert__content">
                Running on testing service: account data may not be stable! Do not use production credentials. 
                OSF Environment: {process.env.NEXT_PUBLIC_OSF_ENV}
            </div>
        </div>
    );
}
