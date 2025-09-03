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
import Trash from "./Trash.mjs";

export default class DataServer extends Componentry.Module {
    constructor(connector) {
        super(connector,import.meta.url)
        this.options = {safeDelete:false,exclude:["user"],global:[]};
        this.parser = Parser;
        this.trash = new Trash(this.connector);
    }
    static Options(options) {
        return class DataServerOptions extends DataServer {
            constructor(connector) {
                super(connector);
                Object.assign(this.options,options);
            }
            static get name() {
                // bit of a hack, but the module needs to be named for the root class
                return "DataServer"
            }
        }
    }

    routes() {
        let router = express.Router();
        // common access control
        router.use('/data/:collection/:item?',async (req,res,next)=> {
            if (!this.options.global.includes(req.params.collection)) {
                let level = 'read';
                if (req.method === 'PUT') level = 'write';
                if (req.method === 'DELETE') level = this.options.safeDelete ? 'write' : 'owner';
                let availableAccounts = await this.connector.acl.get[level]({user: req.account.userId}, 'account');
                availableAccounts = availableAccounts.map(a=>a._id.account);
                req._baseSelector = req._baseSelector||{};
                if (!req.account.super && !availableAccounts.includes(req.account.id)) return res.status(401).send();
                req._baseSelector = Object.assign(req._baseSelector,{_account:req.account.id})
            }
            if (this.options.exclude && this.options.exclude.includes(req.params.collection)) {
                res.status(401).send();
            } else if (this.options.include && this.options.include.includes(req.params.collection)) {
                res.status(401).send();
            } else next();
        })
        // include trash handling
        if (this.options.safeDelete) router.use(this.trash.routes());
        // get collection item(s)
        router.get('/data/:collection/:item?',async(req,res)=>{
            try {
                let selector = req._baseSelector;
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
                res.send(req.params.item?results[0]||{}:results);
            } catch(e) {
                res.status(e.status||500).json({status:"error",message:e.message});
            }
        });
        // put/delete collection item(s)
        router.all('/data/:collection/:item?',async(req,res)=>{
            try {
                if (req.method === 'PUT' || req.method === 'POST') {
                    let result = await this.put(req.account,req.params.collection,req.body,req.params.item);
                    res.json(result);
                } else if (req.method === 'DELETE') {
                    if (req.query?.conditions) {
                        const conditions = this.parser.objectify(req.query.conditions)
                        const usedBy = await this.checkConditions(req.params.collection,req.params.item,conditions)
                        if (usedBy.length > 0) return res.status(423).json({message: 'Cannot be deleted', usedBy})
                    }
                    await this.remove(req.account, req.params.collection, req.params.item, this.makeBool(req.query?.safeDelete));
                    res.status(204).send();
                }
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
     * @param ids
     * @param safeDelete if it's true instead of deleting item will be kept in the trash
     */
    async remove(account,collection,ids,safeDelete) {
        if (!ids) throw new Error('no id provided');
        if (typeof ids === 'string') ids = ids.split(',');
        let selector = {_id:{$in:ids}};
        if (safeDelete) {
            await this.trash.put(account, collection, ids)
        } else {
            await this.connector.db.collection(collection).deleteMany(selector);
        }
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
        let returnNewDocument = true;
        if (Array.isArray(body)) returnNewDocument = false;
        else body = [body];
        if (body.length === 0) throw new Error("Empty data set");
        let writes = [];
        for (let o of body) {
            if (!this.options.global.includes(collection)) {
                if (!o._account ) o._account = account.id;
                else if (!accounts.includes(o._account)) continue;
            }
            writes.push({updateOne:{
                    filter:{_id:(o._id||this.connector.idForge.datedId())},
                    update:constructModifier(o),
                    upsert:true
                }});
        }
        let result = await this.connector.db.collection(collection).bulkWrite(writes);
        if (returnNewDocument && body[0]) {
            return await this.connector.db.collection(collection).findOne({_id: body[0]._id});
        } else {
            return {upsertedCount:result.upsertedCount,modifiedCount:result.modifiedCount};
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

    async checkConditions(collection,ids,conditions) {
        if (!Array.isArray(ids)) ids = [ids]
        if (!Array.isArray(conditions)) conditions = [conditions]
        const usedBy = []
        for (const condition of conditions) {
            const results = await this.connector.db.collection(condition.col)
                .find({[condition.field]: {$in: ids}}).toArray()
            if (results.length > 0) usedBy.push({collection: condition.col, ids: results.map(item => item._id)})
        }
        return usedBy
    }

    makeBool(val) {
        return [true, 'true', 'True', 1, '1'].includes(val)
    }
}
