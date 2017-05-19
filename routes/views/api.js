const keystone = require('keystone'),
    jwt = require('jsonwebtoken'), // for token generation
    os = require("os"), // for hostname
    mongoose = require('mongoose'),
    path = require("path"),
    temp_dir = path.join('../temp/'),
    https = require('https'),
    fs = require('fs'),
    async = require('async'),

    User = keystone.list('User'), // connect to User model
    Category = keystone.list('Categories'), // connect to Categories model
    Product = keystone.list('Products'), // connect to Products model
    Order = keystone.list('Orders'), // connect to Orders model
    Payments = keystone.list('Payments'), // connect to Payments model
    Status = keystone.list('Statuses'), // connect to Statuses model
    Notifications = keystone.list('Notifications'), // connect to Notifications model
    Grades = keystone.list('Grades'),
    Languages = keystone.list('Languages'),

    index = require('../index'), // get token sectret word
    http = require('http'), // for SMS request
    querystring = require('querystring'), // for SMS request
    SMS_API_KEY = '15LGJ454T3YT0H30JUGKGYGW3D4F019W12C2P3MXH54QI5UQD4S66699VEZ1C1GJ'; // for phone verification through SMS

var sendSMS = (phone, text) => {
    let to_phone = phone.replace(/\+/g,''),
        from_phone = '79200518518';

    let uri = [
        'http://smspilot.ru/api.php',
        '?send=', querystring.escape(text),
        '&to=', to_phone,
        '&from=', ,
        '&apikey=', SMS_API_KEY,
        '&format=json'
    ].join('');

    console.log(uri);

    http.get(uri, (response) => {
        var str = ''
        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', () => {
            console.log('Server response: ' + str);
            let parsedData = JSON.parse(str);
        });

    }).on('error', (err) => {
        console.log('Network error ' + err);
    });
}
var generateToken = (phone, id, professional) => {
    let token = jwt.sign({
        phone: phone,
        _id: id,
        professional: professional
    }, index.SECRET_WORD, {expiresIn: '30 days'});

    return token;
};
var createPush = (user_id, receiver, notify_id, order_id) => {
    let api_key;
    let app_id;

    // Check who will receive a message
    switch (receiver) {
        case 'CUSTOMER':
            app_id = index.ONE_SIGNAL_CUSTOMERS_APP_ID;
            api_key = index.ONE_SIGNAL_CUSTOMERS_API_KEY;
            break;
        case 'PROFF':
            app_id = index.ONE_SIGNAL_PROFESSIONALS_APP_ID;
            api_key = index.ONE_SIGNAL_PROFESSIONALS_API_KEY;
            break
    }

    let createRequest = (message) => {
        var headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": "Basic " + api_key
        };

        var options = {
            host: "onesignal.com",
            port: 443,
            path: "/api/v1/notifications",
            method: "POST",
            headers: headers
        };

        var req = https.request(options, function(res) {
            res.on('data', function(data) {
                console.log("Response:");
                console.log(JSON.parse(data));
            });
        });

        req.on('error', function(e) {
            console.log("ERROR:");
            console.log(e);
        });

        req.write(JSON.stringify(message));
        req.end();
    };

    Notifications.model.findOne({number: Number(notify_id)}).then(data => {
        let message = {
            app_id: app_id,
            contents: {"en": data.message},
            headings: {"en": data.headings},
            url: data.url,
            data: {'open_page': data.app_page, id: order_id || null},
            included_segments: ["All"],
            filters: [
                {
                    field: "tag", key: 'user_id', relation: '=', value: user_id.toString()
                }
            ]
        };

        console.log(JSON.stringify(message));

        createRequest(message);
    }, err => {
        console.log('Create PUSH error', err.text);
    })
};
var rewiewListener = (() => {
    let setPushSended = (id) => {
        User.model.findOne({_id: mongoose.Types.ObjectId(id)})
            .then(data => {
                data.push_sended = true;
                data.save((err) => {})
            })
    }

    // Check rewieved users every half part of hour
    setInterval(() => {
        User.model.find({$and: [{reviewed: true}, {push_sended: false}, {professional: true}]}).then(data => {
            for(let item of data) {
                createPush(item._id, 'PROFF', 105)
                setPushSended(item._id);
            }
        }, err => { console.log(err); })
    }, 1800000);
})();

exports = module.exports = {
    facebookAuth: (req, res) => {
        var findUserProfile = (id) => {
            User.model.findOne({facebook_id: id})
                .then(result => {
                    if (!result)
                        res.status(401).json({ result: 'Error', message: 'Undefined facebook profile'})
                    else {
                        let token = generateToken(result.phone, result._id, result.professional);
                        return res.status(200).json({
                            result: 'Success',
                            message: '',
                            data: {
                                'auth-token': token,
                                _id: result._id,
                                phone_verified: result.phone_verified
                            }
                        });
                    }
                }, err => {
                    res.status(500).json({result: 'Error', message: err.message});
                })
        }

        var options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: '/me?access_token=' + req.body.token + '&fields=id',
            method: 'GET'
        };

        var str = '';
        var request = https.request(options, (response) => {
            response.on('data', (d) => { str += d; });
            response.on('end', () => {
                let data = JSON.parse(str);
                findUserProfile(data.id);
            })
        });

        request.on('error', (e) => { console.error(e);});
        request.end();
    },
    facebookRegistration: (req, res) => {
        let passGenerator = () => {
            return (Math.random() * (99999999 - 10000000) + 10000000).toFixed();
        }

        let phoneGenerator = () => {
            return (Math.random() * (9999999999 - 1000000000) + 1000000000).toFixed();
        }

        var registrateNewProfile = (user) => {
            let newUser = new User.model({
                name: {first: user.name, last: null},
                phone: phoneGenerator(),
                email: user.email,
                facebook_id: user.id,
                password: passGenerator(),
                passCode: null,
                professional: req.body.professional,
                phone_verified: false,
                user_active: true,
                canAccessKeystone: false,
                addrs: new Array()
            });

            newUser.save((err, user) => {
                if (err)
                    return res.status(403).json({result: 'Error', message: 'User with this phone number already exist'});

                let token = generateToken(user.phone, user._id, user.professional);

                return res.json({
                    result: 'Success',
                    message: "",
                    data: {
                        _id: user._id,
                        'auth-token': token
                    }
                });
            });
        }

        var options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: '/me?access_token=' + req.body.token + '&fields=id,name,email',
            method: 'GET'
        };

        var str = '';
        var request = https.request(options, (response) => {
            response.on('data', (d) => { str += d; });
            response.on('end', () => {
                let data = JSON.parse(str);
                registrateNewProfile(data);
            })
        });

        request.on('error', (e) => { console.error(e);});
        request.end();
    },

    authentication: (req, res) => {
        if (req.body.phone.indexOf('+') < 0)
            req.body.phone = '+' + req.body.phone;


        User.model.findOne({phone: req.body.phone})
            .then(result => {
                if (!result) {
                    return res.status(401).json({
                        result: 'Error',
                        message: 'Login or password is incorrect'
                    })
                }

                if (result.professional !== req.body.professional) {
                    let message = (result.professional) ? 'User with this phone already define as professional' : 'User with this phone already define as customer';

                    return res.status(401).json({
                        result: 'Error',
                        message: message
                    })
                }

                result._.password.compare(req.body.password, (err, data) => {
                    if (!data) {
                        return res.status(401).json({result: 'Error', message: 'Login or password is incorrect'});
                    }
                    else {
                        let token = generateToken(result.phone, result._id, result.professional);
                        return res.status(200).json({
                            result: 'Success',
                            message: '',
                            data: {
                                'auth-token': token,
                                _id: result._id,
                                phone_verified: result.phone_verified,
                                reviewed: result.reviewed
                            }
                        });
                    }
                })
            }, err => {
                return res.status(500).json({result: 'Error', message: err.message});
            })
    },
    registration: (req, res) => {
        if (req.body.phone.indexOf('+') < 0)
            req.body.phone = '+' + req.body.phone;

        async.series([
            callback => {
                User.model.findOne({phone: req.body.phone}).then(doc => {
                    if (doc)
                        return res.status(403).json({result: 'Error', message: 'User with the same phone number already exist'});
                    else
                        callback();
                })
            },
            callback => {
                let newUser = new User.model({
                    name: req.body.name,
                    phone: req.body.phone,
                    email: req.body.email,
                    password: req.body.password,
                    facebook_id: null,
                    passCode: null,
                    professional: req.body.professional,
                    phone_verified: false,
                    user_active: true,
                    canAccessKeystone: false,
                    addrs: new Array(),
                    skills: req.body.skills,
                    languages: req.body.languages
                });

                newUser.save((err, user) => {
                    if (err) {
                        res.status(500).json({result: 'Error', message: err.message});
                        return callback();
                    }

                    let token = generateToken(user.phone, user._id, user.professional);

                    res.json({
                        result: 'Success',
                        message: "",
                        data: {
                            _id: user._id,
                            'auth-token': token
                        }
                    });

                    return callback();
                });
            }
        ]);
    },
    uploadAvatar: (req, res) => {
        let avatar = null;

        if (req.files.avatar) {
            fs.createReadStream(req.files.avatar.path).pipe(fs.createWriteStream(__dirname + '/../../../temp/' + req.files.avatar.name));
            avatar = {
                filename: req.files.avatar.name,
                size: req.files.avatar.size,
                mimetype: req.files.avatar.mimetype
            };
        }

        User.model.update({_id: mongoose.Types.ObjectId(req.USER_TOKEN_DATA._id)}, {$set: {avatar: avatar}}, (err, result) => {
            if (err)
                return res.status(500).json({result: 'Error',message: err.message});

            return res.json({result: 'Success', message: 'User avatar updated successfully', data: avatar});
        })
    },
    restore: (req, res) => {
        if (req.body.phone.indexOf('+') < 0)
            req.body.phone = '+' + req.body.phone;

        let passGenerator = () => {
            return (Math.random() * (99999999 - 10000000) + 10000000).toFixed();
        }

        let newPassword = passGenerator();
        let text = 'This is your new password: ' + newPassword + ' Don\'t forget to change it in your profile.'

        User.model.findOne({phone: req.body.phone}, (err, user) => {
            if (err)
                return res.status(500).json({result: 'Error',message: err.message});
            else if (!user)
                return res.status(403).json({result: 'Error',message: 'Undefined phone number'});

            sendSMS(req.body.phone, text);
            user.password = newPassword;

            user.save((err) => {
                if (err)
                    return res.status(500).json({result: 'Error',message: err.message});

                return res.json({
                    result: 'Success',
                    message: "Password will send you to your phone",
                    data: {
                        newPassword: newPassword
                    }
                })
            });
        });
    },
    generateSMS: (req, res) => {
        if (req.body.phone.indexOf('+') < 0)
            req.body.phone = '+' + req.body.phone;

        let codeGenerator = () => {
            return (Math.random() * (9999 - 1000) + 1000).toFixed();
        }

        let code = codeGenerator();
        let text = 'Enter this 4-digit code to the App to confirm your phone: ' + code.toString();

        User.model.findOne({phone: req.body.phone}, (err, user) => {
            if (err)
                return res.status(500).json({result: 'Error',message: err.message});
            else if (!user) {
                return res.status(403).json({result: 'Error', message: 'Undefined user'});
            }

            sendSMS(req.body.phone, text);

            user.passCode = code;
            user.save((err) => {
                if (err)
                    return res.status(500).json({result: 'Error',message: err.message});

                return res.json({result: 'Success', message: "Verification code sent to user phone"})
            });
        });
    },
    phoneVerify: (req, res) => {
        let user = req.USER_TOKEN_DATA;

        User.model.findOne({_id: user._id})
            .then(result => {
                if (!result)
                    return res.status(403).json({
                        result: 'Error',
                        message: 'Undefined user'
                    })

                if (result.passCode == req.body.pass_code) {
                    result.phone_verified = true;
                    result.save((err) => {
                        if (err)
                            return res.status(500).json({result: 'Error',message: err.message});

                        return res.json({
                            result: 'Success',
                            message: "Phone verified successfully"
                        })
                    });
                }
                else {
                    return res.status(403).json({
                        result: 'Error',
                        message: "Wrong code"
                    })
                }
            })
    },
    userProfile: (req, res) => {
        let userID = req.params.id;

        User.model.aggregate([
            {$match: {_id: mongoose.Types.ObjectId(userID)}},

            // unwinds
            {$unwind: {path: "$skills", preserveNullAndEmptyArrays: true}},
            {$unwind: {path: "$languages", preserveNullAndEmptyArrays: true}},
            {$unwind: {path: "$grades", preserveNullAndEmptyArrays: true}},

            // lookups
            {$lookup: {from: "products", localField: "skills", foreignField: "_id", as: "skills_obj"} },
            {$lookup: {from: 'languages', localField: 'languages', foreignField: '_id', as: 'languages_obj'}},
            {$lookup: {from: 'grades', localField: 'grades', foreignField: '_id', as: 'grades_obj'}},

            {$unwind: {path: "$skills_obj", preserveNullAndEmptyArrays: true}},
            {$unwind: {path: "$languages_obj", preserveNullAndEmptyArrays: true}},
            {$unwind: {path: "$grades_obj", preserveNullAndEmptyArrays: true}},

            {
                $group: {
                    _id: "$_id",
                    phone: { $first: "$phone" },
                    email: { $first: "$email" },
                    phone_verified: { $first: "$phone_verified" },
                    professional: { $first: "$professional" },
                    name: { $first: "$name"},
                    addrs: { $first: "$addrs"},
                    location: {$first: "$location"},
                    reviewed: {$first: "$reviewed"},
                    rating: {$first: "$rating"},
                    avatar: {$first: "$avatar"},
                    skills: { $addToSet: "$skills_obj" },
                    languages: { $addToSet: "$languages_obj" },
                    grades: { $first: "$grades_obj" }
                }
            }
        ]).exec((err, result) => {
            if (err)
                return res.status(500).json({result: 'Error', message: err.message});

            if (result[0].avatar)
                result[0].avatar.filename = "http://prod.butler-hero.org/files/" + result[0].avatar.filename;

            res.json({result: 'Success', message: '', data: result[0]});
        })
    },
    userProfileUpdate: (req, res) => {
        // TODO: update user update!!!

        let userID = req.params.id;

        User.model.findOne({_id: userID})
            .then(result => {
                if (!result)
                    return res.status(403).json({ result: "Error", message: "Undefined user ID" })

                for(let i in result) {
                    if (i == '_id')
                        continue;
                    else if (i == 'addrs')
                        continue;
                    else if (i == 'passCode')
                        continue;
                    else if (i == 'user_active')
                        continue;
                    else if (i == 'canAccessKeystone')
                        continue;
                    else if (i == '__v')
                        continue;
                    else if (i == 'professional')
                        continue;
                    else if (i == 'phone_verified')
                        continue;
                    else if (req.body.hasOwnProperty(i))
                        result[i] = req.body[i];
                }

                if (req.body.phone && req.body.phone.indexOf('+') < 0)
                    req.body.phone = '+' + req.body.phone;

                // If user update phone, unverify them
                if (req.body.phone) {
                    result.phone = req.body.phone;
                    result.phone_verified = false;
                }

                if (req.body.name)
                    result.name = req.body.name;

                result.save((err) => {
                    if (err)
                        return res.status(500).json({result: 'Error', message: err.message});

                    return res.json({
                        result: 'Success',
                        message: "User profile updated successfull"
                    })
                });
            }, err => {
                return res.status(500).json({result: 'Error',message: err.message});
            })
    },
    addAddress: (req, res) => {
        let userID = req.params.id;

        console.log(req.body);

        User.model.findByIdAndUpdate(
            userID,
            {
                $push: {
                    // addrs: req.body
                    addrs: {
                        'country': req.body.country || null,
                        'geo': req.body.geo || null,
                        'name': req.body.name || null,
                        'number': req.body.number || null,
                        'state': req.body.state || null,
                        'street1': req.body.street1 || null,
                        'street2': req.body.street2 || null,
                        'suburb': req.body.suburb || null
                    }
                }
            },
            (err, model) => {
                if (err)
                    return res.status(500).json({result: 'Error', message: err.message});

                return res.json({result: 'Success', message: 'Address added successfully'});
            }
        );
    },
    updateAddress: (req, res) => {
        let userID = req.params.id;
        let addrID = req.params.addr_id;

        User.model.update(
            {
                _id: mongoose.Types.ObjectId(userID),
                'addrs._id': mongoose.Types.ObjectId(addrID)
            },
            {
                '$set': {
                    'addrs.$.country': req.body.country,
                    'addrs.$.geo': req.body.geo,
                    'addrs.$.name': req.body.name,
                    'addrs.$.number': req.body.number,
                    'addrs.$.state': req.body.state,
                    'addrs.$.street1': req.body.street1,
                    'addrs.$.street2': req.body.street2,
                    'addrs.$.suburb': req.body.suburb
                }
            },
            (err, result) => {
                if (err)
                    return res.status(500).json({result: 'Error', message: err.message});

                console.log(result);

                return res.json({result: 'Success', message: 'Address with id ' + addrID + ' updated successfully'});
            }
        )
    },
    deleteAddress: (req, res) => {
        let userID = req.params.id;
        let addrID = req.params.addr_id;

        User.model.update(
            {
                _id: userID
            },
            {
                $pull: {
                    addrs: {
                        _id : addrID
                    }
                }
            },
            (err, result) => {
                if (err)
                    return res.status(500).json({result: 'Error', message: err.message});

                return res.json({result: 'Success', message: 'Address with id ' + addrID + ' deleted successfully'});
            }
        );
    },
    setLocation: (req, res) => {
        let user = req.USER_TOKEN_DATA;
        let user_location = req.body.location;

        User.model.findOne({_id: user._id})
            .then(result => {
                if (!result)
                    return res.status(403).json({ result: "Error", message: "Undefined user ID" })

                result.location = user_location;
                result.save((err) => {
                    if (err)
                        return res.status(500).json({result: 'Error', message: err.message});

                    return res.json({
                        result: 'Success',
                        message: "User location updated successfull"
                    })
                });
            })


        // CalculateDistance
        var CalculateDistance = (lat1, long1, lat2, long2) => {

            // Translate to a distance
            var distance =
                Math.sin(lat1 * Math.PI) * Math.sin(lat2 * Math.PI) +
                Math.cos(lat1 * Math.PI) * Math.cos(lat2 * Math.PI) * Math.cos(Math.abs(long1 - long2) * Math.PI);

                // Return the distance in miles
                //return Math.acos(distance) * 3958.754;

            // Return the distance in meters
            return Math.acos(distance) * 6370981.162;
        }

        // Find active orders for this professional
        var findActiveOrders = (active_id) => {
            Order.model.findOne({
                prof_id: mongoose.Types.ObjectId(user._id),
                status: mongoose.Types.ObjectId(active_id)
            }).then(data => {
                let distance;

                if (data) {
                    distance = CalculateDistance(data.addr.geo[0], data.addr.geo[1], user_location[0], user_location[1]);
                    if (distance <= 15)
                        return createPush(data.customer_id, 'CUSTOMER', 100, data._id);
                }
                else {
                    console.log('Nothing orders');
                }
            })
        }

        // Get active status _id
        Status.model.findOne({number: 0}).then(data => {
            findActiveOrders(data._id);
        })
    },

    categories: (req, res) => {

        return res.status(404).json({result: "Error", message: 'Page not found'});

        // Category.paginate({
        //     page: req.query.page || 1,
        //     perPage: req.query.page_limit || 999999
        // })
        // .where('available', true)
        // .select({available: 0, createdAt: 0, author: 0, small_description: 0, __v: 0})
        // .exec((err, result) => {
        //     if (err)
        //         return res.status(500).json({result: 'Error', message: err.message});
        //
        //     return res.json({
        //         result: "Success",
        //         message: "",
        //         total: result.total,
        //         data: result.results
        //     })
        // })
    },
    products: (req, res) => {
        Product.model.find()
            .select({__v: 0, image_src: 0, icon_src: 0, map_src: 0, cat_id: 0, locations: 0, count: 0})
            .skip(Number(req.query.skip) || 0)
            .limit(Number(req.query.limit) || 999999)
            .then((data) => {
                for (let item of data) {
                    item.image.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + item.image.filename;
                    item.icon.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + item.icon.filename;
                    item.map_icon.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + item.map_icon.filename;
                }

                return res.json({
                    result: "Success",
                    message: "",
                    total: data.length,
                    data: data
                })
            }, err => { res.status(500).json({result: 'Error', message: err.message}); })
    },
    images: (req, res) => {
        var options = {
            root: temp_dir,
            dotfiles: 'deny',
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true
            }
        };

        var fileName = req.params.file;
        res.sendFile(fileName, options, function (err) {
            if (err && err.statusCode == 404) {
                return res.sendStatus(404);
            } else {
                console.log('Sent:', fileName);
            }
        });
    },

    paymentsTypes: (req, res) => {
        Payments.model.find()
            .select({__v: 0})
            .then(data => {
                return res.json({
                    result: 'Success',
                    message: '',
                    data: data
                })
            }, err => {
                return res.status(500).json({result: 'Error', message: err.message})
            })
    },
    statusTypes: (req, res) => {
        Status.model.find()
            .select({__v: 0})
            .then(data => {
                return res.json({
                    result: 'Success',
                    message: '',
                    data: data
                })
            }, err => {
                return res.status(500).json({result: 'Error', message: err.message})
            })
    },
    ordersList: (req, res) => {
        let user = req.USER_TOKEN_DATA;
        let getData = (findProperties) => {
            Order.model.aggregate([
                {$match: findProperties},

                // for custom pagination
                {$skip: Number(req.query.skip) || 0},
                {$limit: Number(req.query.limit) || 999999},

                // unwinds
                {$unwind: "$status"},
                {$lookup: {from: "statuses", localField: "status", foreignField: "_id", as: "status_obj"}},
                {$unwind: {path: "$status_obj", preserveNullAndEmptyArrays: true}},

                {$unwind: "$payment_type"},
                {$lookup: {from: "payments", localField: "payment_type", foreignField: "_id", as: "payment_type_obj"}},
                {$unwind: {path: "$payment_type_obj", preserveNullAndEmptyArrays: true}},

                {$unwind: "$customer_id"},
                {$lookup: {from: "users", localField: "customer_id", foreignField: "_id", as: "customer_obj"}},
                {$unwind: {path: "$customer_obj", preserveNullAndEmptyArrays: true}},

                {$unwind: {path: "$products", preserveNullAndEmptyArrays: true}},
                {$lookup: {from: "products", localField: "products", foreignField: "_id", as: "skillsObject"}},
                {$unwind: {path: "$skillsObject", preserveNullAndEmptyArrays: true}},

                {$unwind: "$languages"},
                {$lookup: {from: "languages", localField: "languages", foreignField: "_id", as: "language_obj"}},
                {$unwind: {path: "$language_obj", preserveNullAndEmptyArrays: true}},

                {$unwind: {path: "$prof_id", preserveNullAndEmptyArrays: true}},
                {$lookup: {from: "users", localField: "prof_id", foreignField: "_id", as: "prof_obj"}},
                {$unwind: {path: "$prof_obj", preserveNullAndEmptyArrays: true}},

                {$unwind: "$grades"},
                {$lookup: {from: "grades", localField: "grades", foreignField: "_id", as: "grades_obj"}},
                {$unwind: "$grades_obj"},

                // {$unwind: {path: "$linked_orders", preserveNullAndEmptyArrays: true}},
                // {$lookup: {from: "orders", localField: "linked_orders", foreignField: "_id", as: "linked_orders_list"}},
                // {$unwind: "$linked_orders_list"},

                // group
                {
                    $group: {
                        _id: "$_id",
                        statusChangeDate: {$first: '$statusChangeDate'},
                        name: {$first: '$name'},
                        address: {$first: '$addr'},
                        notes: {$first: '$note'},
                        createdAt: {$first: '$createdAt'},
                        status: {$first: "$status_obj"},
                        payment: {$first: "$payment_type_obj"},
                        customer: {$first: '$customer_obj'},
                        professional: {$first: '$prof_obj'},
                        duration: {$first: "$duration"},
                        skills: {$addToSet: "$skillsObject"},
                        languages: {$addToSet: "$language_obj"},
                        grades: {$addToSet: "$grades_obj"},
                        linked_orders_list: {$first: "$linked_orders"}
                    }
                }
            ]).exec((err, data) => {
                if (err)
                    return res.status(500).json({result: 'Error', message: err.message});

                for (let item of data) {
                    for (let i of item.skills) {
                        i.image.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + i.image.filename;
                        i.icon.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + i.icon.filename;
                        i.map_icon.filename = 'https://' + 'prod.butler-hero.org' + '/files/' + i.map_icon.filename;
                    }

                    var arr = item.linked_orders_list.filter(i => {
                       return i.toString() !== item._id.toString();
                    });

                    item.linked_orders_list = arr;
                    item.summary = item.skills.reduce((sum, current) => {
                        return sum + current.price;
                    }, 0);

                    // TODO: leftDuration = duration - current time + time of switch to active
                    item.leftDuration = ((item.duration * 60) - new Date().getTime() + new Date(item.statusChangeDate).getTime()) / 60;

                    if (item.customer) {
                        delete item.customer.addrs;
                        delete item.customer.password;
                        delete item.customer.user_active;
                        delete item.customer.passCode;
                        delete item.customer.canAccessKeystone;
                        delete item.customer.__v

                        if (item.customer.avatar)
                            item.customer.avatar.filename = 'https://prod.butler-hero.org/files/' + item.customer.avatar.filename;
                    }

                    if (item.professional) {
                        delete item.professional.password;
                        delete item.professional.user_active;
                        delete item.professional.passCode;
                        delete item.professional.canAccessKeystone;
                        delete item.professional.__v;

                        if (item.professional.avatar)
                            item.professional.avatar.filename = 'https://prod.butler-hero.org/files/' + item.professional.avatar.filename;
                    }
                }

                return res.json({
                    result: 'Success',
                    message: '',
                    data: data
                });
            });
        };


        if (req.params.id) {
            let findProperties = { '_id': mongoose.Types.ObjectId(req.params.id) };
            getData(findProperties);
        }
        else if (!user.professional) {
            let findProperties = { 'customer_id': mongoose.Types.ObjectId(user._id) };
            getData(findProperties);
        }
        if (user.professional && req.params.status == 'history') {
            let findProperties = { 'prof_id': mongoose.Types.ObjectId(user._id) };
            getData(findProperties);
        }
        else if (user.professional) {
            Status.model.find()
                .then(data => {
                    let findProperties = {
                        $and: new Array()
                    };

                    let statusNumber;

                    switch (req.params.status) {
                        case 'active':
                            statusNumber = 1;
                            findProperties.$and.push({'prof_id': mongoose.Types.ObjectId(user._id)});
                            break;
                        case 'pending':
                            statusNumber = 0;
                            break;
                    }

                    for(let item of data) {
                        if (item.number == statusNumber) {
                            findProperties.$and.push({'status': mongoose.Types.ObjectId(item._id)});
                            break;
                        }
                    }

                    getData(findProperties);

                }, err => { res.status(500).json({result: 'Error', message: err.message}); })
        }
    },
    createOrder: (req, res) => {

        this.orders = new Array();
        this.ids = new Array();
        this.distances = [1000, 2000, 5000, 10000, 15000];
        this.index = 0;
        this.professionalsList = new Array();
        this.cancelStatusId = null;

        this.checkQuantity = () => {
            if (req.body.quantity > 1)
                this.separateOrders();
            else
                this.createOrder();
        };

        this.separateOrders = () => {
            for (let i=0; i < req.body.quantity; i++) {
                this.createOrder();
            }
        };

        this.createOrder = () => {
            let user = req.USER_TOKEN_DATA;
            var totalPrice = 0;

            if (user.professional) {
                return res.status(400).json({
                    result: 'Error',
                    message: 'Professional can\t create order'
                })
            }

            this.skillsArr = req.body.skills.map(item => {
                return mongoose.Types.ObjectId(item);
            });

            this.languagesArr = req.body.languages.map(item => {
                return mongoose.Types.ObjectId(item);
            });

            this.gradesArr = req.body.grades.map(item => {
                return mongoose.Types.ObjectId(item);
            });

            // Find products in storage for total price of order
            Product.model.find({
                _id: {$in: this.skillsArr}
            }, (err, docs) => {
                for (let item of docs) {
                    totalPrice += Number(item.price);
                }
            });

            // Generate order ID
            let generateOrderNumber = () => {
                return (Math.random() * (999999 - 100000) + 100000).toFixed();
            };

            // Create order model
            let newOrder = new Order.model({
                name: generateOrderNumber(),
                status: mongoose.Types.ObjectId(req.body.status),

                products: this.skillsArr,
                languages: this.languagesArr,
                grades: this.gradesArr,
                duration: Number(req.body.duration),

                customer_id: mongoose.Types.ObjectId(user._id),
                addr: req.body.addr,
                payment_type: mongoose.Types.ObjectId(req.body.payment_type),
                note: req.body.note,
                summary: null
            });

            // Find status id for dafault status
            Status.model.find()
                .then(data => {
                    for (let item of data) {
                        if (item.number === 0) {
                            newOrder.status = mongoose.Types.ObjectId(item._id);
                            newOrder.summary = totalPrice;
                        }
                        else if (item.number === 5) {
                            this.cancelStatusId = mongoose.Types.ObjectId(item._id);
                        }
                    }

                    this.orders.push(newOrder);
                    this.saveOrder();
                }, err => {
                    res.status(500).json({result: 'Error', message: err.message});
                })
        };

        this.saveOrder = () => {
            if (this.orders.length !== req.body.quantity)
                return;

            for(let item of this.orders) {
                item.save((err, order) => {
                    if (err) {
                        res.status(500).json({result: 'Error', message: err.message});
                        return;
                    }

                    this.ids.push(mongoose.Types.ObjectId(order._id));

                    if (this.ids.length === this.orders.length) {
                        res.json({result: 'Success', message: 'Order created successfull', data: this.ids});

                        Order.model.update({_id: { $in: this.ids }}, {linked_orders: this.orders}, {multi: true}).then((err, result) => {
                            if (err) return console.log(err);
                        });

                        this.findProfessional();
                    }
                })
            }
        };

        this.findProfessional = () => {
            if (this.index == (this.distances.length))
                return this.cancelOrders();

            User.model.find({
                $and: [
                    {grades: {$in: this.gradesArr}},
                    {languages: {$in: this.languagesArr}},
                    {skills: {$in: this.skillsArr}},
                    {location: {
                        $near: {
                            $geometry: {
                                type: "Point" ,
                                coordinates: req.body.addr.geo
                            },
                            $maxDistance: this.distances[this.index], // in meters
                            $minDistance: 0
                        }
                    }}
                ]
            }).exec((err, docs) => {
                if (err)
                    console.log('Error', err.message);
                else if (!docs.length) {
                    this.index++;
                    return this.findProfessional();
                }

                for(let item of docs) {
                    this.professionalsList.push(item);
                }

                if (this.professionalsList < req.body.quantity) {
                    this.index++;
                    return this.findProfessional();
                } else {
                    return this.sendPushToProfessionals();
                }
            });
        };

        this.sendPushToProfessionals = () => {
            for(let item of this.professionalsList) {
                createPush(item, 'PROFF', 105, this.ids[0]);
            }
        };

        this.cancelOrders = () => {
            console.log(this.ids);
            Orders.model.updateMany({_id: {$in: this.ids}}, {status: this.cancelStatusId}).exec((err, result) => {
                if (err)
                    console.log('Error', err.message);

                console.log(result);
            })
        };

        this.checkQuantity();
    },
    changeStatus: (req, res) => {
        let user = req.USER_TOKEN_DATA;

        let orderId = req.params.order_id;
        let statusNumber;
        let setObject;
        let findObject;

        switch (req.params.status) {
            case 'pending':
                statusNumber = 0;
                break;
            case 'active':
                statusNumber = 1;
                break;
            case 'reject':
                statusNumber = 2;
                break;
            case 'cancel':
                statusNumber = 3;
                break;
            case 'complete':
                statusNumber = 4;
                break;
        }

        async.parallel([
            callback => {
                Status.model.findOne({number: statusNumber})
                    .then(data => {
                        callback(null, {status_id: data._id, status_num: data.number});
                    });
            },
            callback => {
                Order.model.findOne({_id: mongoose.Types.ObjectId(orderId)}, {_id: 1, linked_orders: 1})
                    .then(doc => {
                        callback(null, doc);
                    })
            }
        ], (err, results) => {
            let statusId = results[0].status_id;
            let statusNum = results[0].status_num;
            let links = results[1].linked_orders;

            // let links = results[1].linked_orders.map(item => {
            //     return mongoose.Types.ObjectId(item);
            // });

            changeOrder(statusId, statusNum, links);
        });

        let changeOrder = (statusId, num, linkedOrders) => {

            if (num == 0) {
                setObject = {
                    prof_id: null,
                    status: mongoose.Types.ObjectId(statusId)
                }
            }
            else if (num == 1) {
                setObject = {
                    prof_id: mongoose.Types.ObjectId(user._id),
                    status: mongoose.Types.ObjectId(statusId)
                }
            }
            else if (num == 2 || num == 3) {
                findObject = { _id: {$in: linkedOrders} };
                setObject = { status: mongoose.Types.ObjectId(statusId) };
            }
            else {
                setObject = { status: mongoose.Types.ObjectId(statusId) };
                findObject = { _id: mongoose.Types.ObjectId(orderId) };
            }

            setObject.statusChangeDate = new Date();

            Order.model.update(
                findObject,
                {
                    '$set': setObject
                },
                {
                    multi: true
                },
                (err, result) => {
                    if (err)
                        return res.status(500).json({result: 'Error', message: err.message});

                    findAndGeneratePush();
                    return res.json({result: 'Success', message: 'Order status changed successfully'});
                }
            );

            let findAndGeneratePush = () => {
                Order.model.findOne({
                    _id: mongoose.Types.ObjectId(orderId)
                }).then(data => {
                    switch (statusNumber) {
                        // Order created with status pending, do nothing
                        case 0:
                            break;

                        // Order update to active status, send PUSH to customer
                        case 1:
                            createPush(data.customer_id, 'CUSTOMER', 101, data._id);
                            break;

                        // Order cancelled by professional, send push to customer
                        case 2:
                            createPush(data.customer_id, 'CUSTOMER', 102, data._id);
                            break;

                        // Order cancelled by customer, send push to professional
                        case 3:
                            createPush(data.prof_id, 'PROFF', 103, data._id);
                            break;

                        // Order complete, send push to customer
                        case 4:
                            createPush(data.customer_id, 'CUSTOMER', 104, data._id);
                            break;
                    }
                })
            }
        }
    },
    routeChange: (req, res) => {
        let user = req.USER_TOKEN_DATA;
        let order_id = req.params.order_id;
        let route = req.body.route;

        Order.model.update(
            {
                _id: mongoose.Types.ObjectId(order_id)
            },
            {
                '$set': {route: route}
            },
            (err, result) => {
                if (err)
                    return res.status(500).json({result: 'Error', message: err.message});

                return res.json({result: 'Success', message: 'Order route changed successfully'});
            }
        )
    },

    gradesList: (req, res) => {
        Grades.model.find()
            .select({__v: 0})
            .then(data => {
                return res.json({
                    result: 'Success',
                    message: '',
                    data: data
                })
            }, err => {
                return res.status(500).json({result: 'Error', message: err.message});
            })
    },
    languagesList: (req, res) => {
        Languages.model.find()
            .select({__v: 0})
            .then(data => {
                return res.json({
                    result: 'Success',
                    message: '',
                    data: data
                })
            }, err => {
                return res.status(500).json({result: 'Error', message: err.message});
            })
    }
};
