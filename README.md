![Validate Status](https://github.com/mknuts/se.oxiecloud.monta/actions/workflows/validate.yml/badge.svg)

# Monta EV Charger for Homey


Control your Monta connected EV charger from Homey.

To use this app you need to connect your EV charger to Montas backend (connection is free of charge
for private owned chargers). You must have the nessecary tools and credentials to be able to configure your EV charger to connect to Montas backend. The charger must be able to connect to Internet.

To get started, download "Monta Charge" to your phone and register for an account (you might already have one if you have used the app to charge at Monta connected public chargers). In the app, select "chargers" and press the three dots in the upper right and choose "connect a charger" and follow the guidelines.
When you have your charger operational in Montas app then you can continue and register an application with Monta so that you can get access to their public API.
When registering you will get a Client ID and a Client secret, and you need these two parameters to be able
to use this app. You register here -> https://portal2.monta.app/applications

When everyting above is done, then you can install the app. You should go directly to the app settings and enter your ClientID and ClientSecret. When done you can verify your credentials and if it works you are ready to add your charger in Homey.

