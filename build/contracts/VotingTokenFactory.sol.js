var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("VotingTokenFactory error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("VotingTokenFactory error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("VotingTokenFactory contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of VotingTokenFactory: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to VotingTokenFactory.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: VotingTokenFactory not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "created",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "isVotingForToken",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "isVotingAgainstToken",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "createVotingoken",
        "outputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      }
    ],
    "unlinked_binary": "0x606060405261166a806100126000396000f3606060405260e060020a60003504635f8dead3811461003c5780636be925e61461007857806378b188a414610093578063d40b05af146100ae575b005b61014160043560243560006020819052828152604090208054829081101561000257506000908152602090200154600160a060020a0316905081565b61015e60043560016020526000908152604090205460ff1681565b61015e60043560026020526000908152604090205460ff1681565b610172600060006000600060405161098a80610356833901809050604051809103906000f0915060405161098a80610ce0833901809050604051809103906000f0600160a060020a03331690915260208390526040832080546001810180835582818380158290116101a1576000838152602090206101a19181019083015b80821115610210576000815560010161012d565b60408051600160a060020a03929092168252519081900360200190f35b604080519115158252519081900360200190f35b6040518083600160a060020a0316815260200182600160a060020a031681526020019250505060405180910390f35b5050506000928352506020808320909101805473ffffffffffffffffffffffffffffffffffffffff19168517905533600160a060020a0316825281905260409020805460018101808355828183801582901161021457818360005260206000209182019101610214919061012d565b5090565b5050506000928352506020808320909101805473ffffffffffffffffffffffffffffffffffffffff191684179055600160a060020a0384811680845260018084526040808620805460ff1990811684179091558785168752818720805490911690921790915580517fa9059cbb0000000000000000000000000000000000000000000000000000000081523390931660048401526064602484015251909363a9059cbb936044848101949193929183900301908290876161da5a03f11561000257505060405151151590506102e857610002565b80600160a060020a031663a9059cbb3360646040518360e060020a0281526004018083600160a060020a03168152602001828152602001925050506020604051808303816000876161da5a03f115610002575050604051511515905061034d57610002565b909390925090505660a060405260046060527f48302e31000000000000000000000000000000000000000000000000000000006080526006805460008290527f48302e310000000000000000000000000000000000000000000000000000000882556100b5907ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f602060026001841615610100026000190190931692909204601f01919091048101905b808211156101b257600081556001016100a1565b5050604080518082018252600e81527f566f74696e67466f72546f6b656e00000000000000000000000000000000000060208281019182528351808501855260038082527f56465400000000000000000000000000000000000000000000000000000000008284015233600160a060020a0316600090815260018085529681206064908190558082558651835484845291989296949593947fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b600294841615610100026000190190931693909304601f908101949094048201939092908390106101b657805160ff19168380011785555b506101e69291506100a1565b5090565b828001600101855582156101a6579182015b828111156101a65782518260005055916020019190600101906101c8565b50506004805460ff191683179055805160058054600082905290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db0602060026001851615610100026000190190941693909304601f90810184900482019386019083901061026857805160ff19168380011785555b506102989291506100a1565b8280016001018555821561025c579182015b8281111561025c57825182600050559160200191906001019061027a565b5050505050506106de806102ac6000396000f36060604052361561008d5760e060020a600035046306fdde038114610095578063095ea7b3146100f357806318160ddd1461016857806323b872dd14610171578063313ce5671461025e57806354fd4d501461026a57806370a08231146102c857806395d89b41146102f6578063a9059cbb14610354578063cae9ca51146103fb578063dd62ed3e146105c2575b6105f6610002565b6040805160038054602060026001831615610100026000190190921691909104601f81018290048202840182019094528383526105f893908301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b61066660043560243533600160a060020a03908116600081815260026020908152604080832094871680845294825280832086905580518681529051929493927f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925929181900390910190a35060015b92915050565b6102e460005481565b610666600435602435604435600160a060020a0383166000908152600160205260408120548290108015906101c4575060026020908152604080832033600160a060020a03168452909152812054829010155b80156101d05750600082115b156106c357600160a060020a03838116600081815260016020908152604080832080548801905588851680845281842080548990039055600283528184203390961684529482529182902080548790039055815186815291519293927fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9281900390910190a35060016106c7565b61067a60045460ff1681565b6040805160068054602060026001831615610100026000190190921691909104601f81018290048202840182019094528383526105f893908301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b600160a060020a03600435166000908152600160205260409020545b60408051918252519081900360200190f35b6105f86005805460408051602060026001851615610100026000190190941693909304601f810184900484028201840190925281815292918301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b61066660043560243533600160a060020a03166000908152600160205260408120548290108015906103865750600082115b156106ce5733600160a060020a03908116600081815260016020908152604080832080548890039055938716808352918490208054870190558351868152935191937fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef929081900390910190a3506001610162565b604080516020604435600481810135601f810184900484028501840190955284845261066694813594602480359593946064949293910191819084018382808284375094965050505050505033600160a060020a03908116600081815260026020908152604080832094881680845294825280832087905580518781529051929493927f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925929181900390910190a383600160a060020a031660405180807f72656365697665417070726f76616c28616464726573732c75696e743235362c81526020017f616464726573732c627974657329000000000000000000000000000000000000815260200150602e019050604051809103902060e060020a9004338530866040518560e060020a0281526004018085600160a060020a0316815260200184815260200183600160a060020a031681526020018280519060200190808383829060006004602084601f0104600302600f01f150905090810190601f16801561059a5780820380516001836020036101000a031916815260200191505b509450505050506000604051808303816000876161da5a03f19250505015156106d657610002565b6102e4600435602435600160a060020a03828116600090815260026020908152604080832093851683529290522054610162565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156106585780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b604080519115158252519081900360200190f35b6040805160ff9092168252519081900360200190f35b820191906000526020600020905b81548152906001019060200180831161069e57829003601f168201915b505050505081565b5060005b9392505050565b506000610162565b5060016106c75660a060405260046060527f48302e31000000000000000000000000000000000000000000000000000000006080526006805460008290527f48302e310000000000000000000000000000000000000000000000000000000882556100b5907ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f602060026001841615610100026000190190931692909204601f01919091048101905b808211156101b257600081556001016100a1565b5050604080518082018252601281527f566f74696e67416761696e7374546f6b656e000000000000000000000000000060208281019182528351808501855260038082527f56415400000000000000000000000000000000000000000000000000000000008284015233600160a060020a0316600090815260018085529681206064908190558082558651835484845291989296949593947fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b600294841615610100026000190190931693909304601f908101949094048201939092908390106101b657805160ff19168380011785555b506101e69291506100a1565b5090565b828001600101855582156101a6579182015b828111156101a65782518260005055916020019190600101906101c8565b50506004805460ff191683179055805160058054600082905290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db0602060026001851615610100026000190190941693909304601f90810184900482019386019083901061026857805160ff19168380011785555b506102989291506100a1565b8280016001018555821561025c579182015b8281111561025c57825182600050559160200191906001019061027a565b5050505050506106de806102ac6000396000f36060604052361561008d5760e060020a600035046306fdde038114610095578063095ea7b3146100f357806318160ddd1461016857806323b872dd14610171578063313ce5671461025e57806354fd4d501461026a57806370a08231146102c857806395d89b41146102f6578063a9059cbb14610354578063cae9ca51146103fb578063dd62ed3e146105c2575b6105f6610002565b6040805160038054602060026001831615610100026000190190921691909104601f81018290048202840182019094528383526105f893908301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b61066660043560243533600160a060020a03908116600081815260026020908152604080832094871680845294825280832086905580518681529051929493927f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925929181900390910190a35060015b92915050565b6102e460005481565b610666600435602435604435600160a060020a0383166000908152600160205260408120548290108015906101c4575060026020908152604080832033600160a060020a03168452909152812054829010155b80156101d05750600082115b156106c357600160a060020a03838116600081815260016020908152604080832080548801905588851680845281842080548990039055600283528184203390961684529482529182902080548790039055815186815291519293927fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9281900390910190a35060016106c7565b61067a60045460ff1681565b6040805160068054602060026001831615610100026000190190921691909104601f81018290048202840182019094528383526105f893908301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b600160a060020a03600435166000908152600160205260409020545b60408051918252519081900360200190f35b6105f86005805460408051602060026001851615610100026000190190941693909304601f810184900484028201840190925281815292918301828280156106bb5780601f10610690576101008083540402835291602001916106bb565b61066660043560243533600160a060020a03166000908152600160205260408120548290108015906103865750600082115b156106ce5733600160a060020a03908116600081815260016020908152604080832080548890039055938716808352918490208054870190558351868152935191937fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef929081900390910190a3506001610162565b604080516020604435600481810135601f810184900484028501840190955284845261066694813594602480359593946064949293910191819084018382808284375094965050505050505033600160a060020a03908116600081815260026020908152604080832094881680845294825280832087905580518781529051929493927f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925929181900390910190a383600160a060020a031660405180807f72656365697665417070726f76616c28616464726573732c75696e743235362c81526020017f616464726573732c627974657329000000000000000000000000000000000000815260200150602e019050604051809103902060e060020a9004338530866040518560e060020a0281526004018085600160a060020a0316815260200184815260200183600160a060020a031681526020018280519060200190808383829060006004602084601f0104600302600f01f150905090810190601f16801561059a5780820380516001836020036101000a031916815260200191505b509450505050506000604051808303816000876161da5a03f19250505015156106d657610002565b6102e4600435602435600160a060020a03828116600090815260026020908152604080832093851683529290522054610162565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156106585780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b604080519115158252519081900360200190f35b6040805160ff9092168252519081900360200190f35b820191906000526020600020905b81548152906001019060200180831161069e57829003601f168201915b505050505081565b5060005b9392505050565b506000610162565b5060016106c756",
    "events": {},
    "updated_at": 1476211381689
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "VotingTokenFactory";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.VotingTokenFactory = Contract;
  }
})();