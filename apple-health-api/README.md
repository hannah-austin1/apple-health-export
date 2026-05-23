# Personal Apple Health export API

A Firebase project to parse and store Apple Health data from your iPhone. Using a Firebase HTTP function to parse the data and Firestore to store the data. Use [Firebase JS SDK](https://firebase.google.com/docs/web/setup) to use it in your web applications.

See [Firestore](https://firebase.google.com/docs/firestore) and [Functions](https://firebase.google.com/docs/functions) documentations for further details.



---

## Prerequisites

Before starting to use this project you need to do some manual work. Please see the below table.

|                    | Description                                             |
| ------------------ | ------------------------------------------------------- |
| [Firebase Project] | Setup a Firebase project with default location selected |
| [Firestore]        | Setup a Firestore database in native mode               |

[firebase project]: https://firebase.google.com/docs/projects/locations#view-settings
[firestore]: https://cloud.google.com/datastore/docs/firestore-or-datastore#choosing_a_database_mode

## Install

```bash
# Clone the project
git clone git@github.com:hannah-austin1/apple-health-export.git

# Go to project folder
cd apple-health-api

# Login to Firebase
npx firebase-tools login

# Init the firebase project
npx firebase-tools init
```

After running the `init` command just follow the interactive CLI. You will se the URL of Firebase function after the initialization. You need this URL to use in Shortcuts.

## Deployment

```bash
npx firebase-tools deploy
```
