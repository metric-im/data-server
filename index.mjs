/**
 * Generic database services for metric componentry.
 *
 * GET, PUT, DELETE /{collection}/{id}?options
 *
 * Use DataServer.Options() to modify the default handling of the DataServer class.
 * * *include*: Array. If provided only named collections in the array are honored
 * * *exclude*: Array. A collection named in the array is not honored.
 * * *acl*: One of ACL constants. Indicates how to handle access control
 * * *safeDelete*: Boolean. DELETE moves items into trash collection. Trash can be emptied.
 *
 * NOTE: access control is only enforced for web requests. Internal requests to get() or
 * put() directly need to be cleared independently.
 */
import Parser from './Parser.mjs';
import express from 'express';
import Componentry from "@metric-im/componentry";

export default class DataServer extends Componentry.Module {
    constructor(connector) {
        super(connector,import.meta.url)
        this.options = {safeDelete:false,exclude:["user"]};
        this.parser = Parser;
        this.trashCollection = this.connector.db.collection('data_server_trash');
    }
    static Options(options) {
        return class DataServerOptions extends DataServer {
            constructor(connector) {
                super(connector);
                this.options = options;
            }
        }
    }

    routes() {
        let router = express.Router();
        // If either include or exclude are defined, skip collections not implicitly or explicitly named
        if (this.options.include || this.options.exclude) {
            router.use('/data/:collection/:item?',async (req,res,next)=> {
                if ((this.options.exclude?.includes(req.params.collection)) ||
                    (!this.options.include?.includes(req.params.collection))) {
                    res.status(401).send();
                } else next();
            })
        }
        router.use('/data/:collection/:item?',async (req,res,next)=> {
            let level = 'read';
            if (req.method === 'PUT') level = 'write';
            if (req.method === 'DELETE') level = this.options.safeDelete ? 'create' : 'owner';
            let availableAccounts = await this.connector.acl.get[level]({user: req.account.userId}, 'account');
            req._availableAccounts = availableAccounts.map(a=>a._id.account);
            next();
        })
        router.get('/data/account/:item?',async (req,res,next)=> {
            try {
                let selector = {};
                if (req.params.item) {
                    if (!req.account.super && !req._availableAccounts.includes(req.params.item)) return res.status(401).send();
                    selector._id = req.params.item;
                } else if (!req.account.super) {
                    selector._id = {$in:req._availableAccounts};
                }
                if (req.query.where) Object.assign(selector,this.parser.objectify(req.query.where));
                let sort = (req.query.sort)?this.parser.sortify(req.query.sort):{_id:1};
                let results = await this.connector.db.collection(collection).find(selector).collation({ locale:"en_US", strength:2}).sort(sort).toArray();
                return (req.params.item?results[0]||{}:results);
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        })
        router.put('/data/account/:item?',async (req,res)=> {
            try {
                res.status(500).json({status:"error",message:"Not implemented. Use account server."});
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        })
        router.delete('/data/account/:item?',async (req,res)=> {
            try {
                res.status(500).json({status:"error",message:"Not implemented. Use account server."});
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        })
        router.get('/data/:collection/:item?',async(req,res)=>{
            try {
                if (!req.account.super && !req._availableAccounts.includes(req.account.id)) return res.status(401).send();
                let selector = {_account:req.account.id};
                if (req.params.item) selector._id = req.params.item;
                if (req.query.where) Object.assign(selector,this.parser.objectify(req.query.where));
                let sort = (req.query.sort)?this.parser.sortify(req.query.sort):{_id:1};
                let results = [];
                let cursor = this.options.nocase?
                    await this.connector.db.collection(req.params.collection).find(selector).collation({ locale:"en_US", strength:2}).sort(sort):
                    await this.connector.db.collection(req.params.collection).find(selector).sort(sort)
                for await (let record of cursor) {
                    if (this.options.limit && results.length >= this.options.limit) break;
                    else results.push(record);
                }
                return (req.params.item?results[0]||{}:results);
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        router.put('/data/:collection/:item?',async(req,res)=>{
            try {
                if (!req.account.super && !req._availableAccounts.includes(req.account.id)) return res.status(401).send();
                let result = await this.put(req.account,req.params.collection,req.body,req.params.item);
                res.json(result);
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        router.delete('/data/:collection/:ids',async(req,res)=>{
            try {
                if (!req.account.super && !req._availableAccounts.includes(req.account.id)) return res.status(401).send();
                await this.remove(req.account,req.params.collection,req.params.ids.split(','));
                res.status(204).send();
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        return router;
    }

    /**
     * DEPRECATED: Not used.
     *
     * Query collections in the database.
     *
     * When an item id is provided the results are provided as a single
     * object. If not, the results are provided in an array.
     *
     * @param account provides context. (Maybe no longer necessary as acl is only applied to web request)
     * @param collection the name of the collection to collect data from.
     * @param item the id (_id) of the item in the collection. (optional)
     * @param options options to limit, sort or format the results
     * @returns Object
     */
    async get(account,collection,item,options={}) {
        let selector = {};
        if (item) selector._id = item;
        if (options.where) Object.assign(selector,this.parser.objectify(options.where));
        let sort = this.parser.sortify(options.sort);

        let results = [];
        let cursor = options.nocase?
            await this.connector.db.collection(collection).find(selector).collation({ locale:"en_US", strength:2}).sort(sort):
            await this.connector.db.collection(collection).find(selector).sort(sort)
        for await (let record of cursor) {
            if (options.limit && results.length >= options.limit) break;
            else results.push(record);
        }
        return (item?results[0]||{}:results);
    }

    /**
     * Remove the identified item(s) from the collection. Item must belong to the
     * session account.id and user must have write rights. A single id passed as
     * a string is treated as ['id'];
     *
     * @param account context.
     * @param collection the name of the collection in which the item is declared
     * @param item item identifier
     */
    async remove(account,collection,ids) {
        if (!ids) throw new Error('no id provided');
        if (typeof ids === 'string') ids = [ids];
        let selector = {_account:account.id,_id:{$in:ids}};
        await this.connector.db.collection(collection).deleteMany(selector);
    }

    /**
     * Put an object (or array of objects) into the specified collection.
     * The request is constructed as an upsert. If no item id is provided,
     * one is generated using Identifier.new.
     *
     * All objects should have and _account attribute, or one is assigned based
     * on the current account. PUT ensures the current user as rights to select
     * or modify this account.
     *
     * @param account context.
     * @param collection the name of the collection to collect data from.
     * @param body an object or array of objects
     * @param id can also be provided explicitly in the url if body is a single object
     * @returns Object
     */
    async put(account,collection,body,id) {
        let accounts = await this.connector.acl.get.write({user:account.userId},"account");
        accounts = accounts.map(a=>a._id.account);
        if (account.super) accounts.push(account.id);
        if (Array.isArray(body)) {
            if (body.length === 0) throw new Error("Empty data set");
            let writes = [];
            for (let o of body) {
                if (!o._account) o._account = account.id;
                else if (!accounts.includes(o._account)) continue;
                writes.push({updateOne:{
                    filter:{_id:(o._id||this.connector.idForge.datedId())},
                    update:constructModifier(o),
                    upsert:true
                }});
            }
            let result = await this.connector.db.collection(collection).bulkWrite(writes);
            return {upsertedCount:result.upsertedCount,modifiedCount:result.modifiedCount};
        } else {
            let selector = {_id:body._id||id||this.connector.idForge.datedId()};
            if (!body._account) body._account = account.id;
            else if (!accounts.includes(body._account)) {
                let error = new Error();
                error.status = 401;
                throw error;
            }
            let modifier = constructModifier(body);
            let options = {upsert:true,returnNewDocument:true};
            let result = await this.connector.db.collection(collection).findOneAndUpdate(selector,modifier,options);
            if (!result.value && result.ok) {
                result.value = await this.connector.db.collection(collection).findOne({_id:selector._id})
            }
            return result.value;
        }

        function constructModifier(doc) {
            let modifier = {$set:{}};
            for (let a in doc) {
                if (['$push','$pull','$addToSet','$unset','$set'].includes(a)) modifier[a] = doc[a];
                else if (!['_id','_created','_createdBy'].includes(a)) modifier.$set[a] = doc[a];
            }
            modifier.$set._modified = new Date();
            modifier.$setOnInsert = {_created:new Date()};
            if (!doc._createdBy) modifier.$setOnInsert._createdBy = account.userId;
            return modifier;
        }
    }
    /**
     * Not in use yet... not tested
     * @param col
     * @param id
     * @param user
     * @returns {Promise<AggregationCursor<Document>>}
     */
    async trash(col,id,user='unknown') {
        let result = await this.db.collection(col).aggregate([
            {match:{_id:id}},
            {project:{_user:user,o:"$ROOT",_created:new Date()}},
            {$merge:{into:'trash',on:"_id"}}
        ]);
        return result;
    }
}
